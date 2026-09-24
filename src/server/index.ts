import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Room, type Client } from './room';
import type { C2S } from '../shared/protocol';
import { cellsHash } from '../shared/hash';
import fs from 'node:fs';
import path from 'node:path';

// ── Token bucket rate limiter per socket ──

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const BUCKET_BURST = 100;
const BUCKET_REFILL_RATE = 30; // msgs/s

function newBucket(): Bucket {
  return { tokens: BUCKET_BURST, lastRefill: Date.now() };
}

function tryConsume(bucket: Bucket): boolean {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(BUCKET_BURST, bucket.tokens + elapsed * BUCKET_REFILL_RATE);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens--;
  return true;
}

// ── Origin check ──

function checkOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers['origin'];
  if (!origin) return true; // no Origin header → allow

  const host = req.headers['host'] ?? '';

  let originHost: string;
  try {
    originHost = new URL(origin).hostname;
  } catch {
    return false;
  }

  // localhost/127.0.0.1 always allowed
  if (originHost === 'localhost' || originHost === '127.0.0.1') return true;

  // Same host check
  const hostWithoutPort = host.split(':')[0] ?? '';
  if (originHost === hostWithoutPort) return true;

  // ALLOWED_ORIGINS env
  const allowed = process.env['ALLOWED_ORIGINS'];
  if (allowed) {
    const list = allowed.split(',').map(s => s.trim());
    if (list.includes(originHost)) return true;
  }

  return false;
}

// ── Name sanitization ──

function sanitizeName(raw: string): string {
  // Strip control characters
  const stripped = String(raw).replace(/[\x00-\x1f\x7f]/g, '');
  const trimmed = stripped.trim().slice(0, 24);
  return trimmed || 'Guest';
}

// ── Persistence ──

const PERSIST_INTERVAL = 5000;

function persistPath(dataDir: string): string {
  return path.join(dataDir, 'sheet.json');
}

function loadState(dataDir: string): { v: number; cells: [string, string][] } | null {
  const p = persistPath(dataDir);
  try {
    const data = fs.readFileSync(p, 'utf8');
    return JSON.parse(data) as { v: number; cells: [string, string][] };
  } catch {
    return null;
  }
}

function saveState(dataDir: string, v: number, cells: Map<string, string>): void {
  const p = persistPath(dataDir);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const entries: [string, string][] = [];
  for (const [id, raw] of cells) {
    entries.push([id, raw]);
  }
  const json = JSON.stringify({ v, cells: entries });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, p);
}

// ── Server factory ──

export interface ServerOptions {
  port?: number;
  persist?: boolean;
}

export interface ServerHandle {
  close: () => Promise<void>;
  port: number;
  room: Room;
}

export function startServer(opts: ServerOptions = {}): ServerHandle {
  const persist = opts.persist ?? false;
  const requestedPort = opts.port ?? 0;
  const dataDir = path.resolve('data');

  const room = new Room('main');

  // Load persisted state
  if (persist) {
    const state = loadState(dataDir);
    if (state) {
      room.loadState(state.v, state.cells);
    }
  }

  // HTTP server with /debug/hash
  const httpServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/debug/hash') {
      const v = room.getVersion();
      const hash = cellsHash(room.getRaw());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ v, hash }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  });

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: 256 * 1024, // 256 KB
  });

  // Ping interval for liveness
  const PING_INTERVAL = 15_000;

  wss.on('connection', (ws, req) => {
    // Origin check
    if (!checkOrigin(req)) {
      ws.close(4003, 'origin rejected');
      return;
    }

    let client: Client | null = null;
    let clientCid: string | undefined;
    let alive = true;
    const bucket = newBucket();

    ws.on('pong', () => { alive = true; });

    ws.on('error', () => {
      clearInterval(pingTimer);
      ws.terminate();
    });

    const pingTimer = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, PING_INTERVAL);

    ws.on('message', (data) => {
      // Rate limit
      if (!tryConsume(bucket)) {
        clearInterval(pingTimer);
        ws.terminate();
        return;
      }

      const str = typeof data === 'string' ? data : data.toString('utf8');
      let msg: C2S;
      try {
        msg = JSON.parse(str) as C2S;
      } catch {
        ws.send(JSON.stringify({ t: 'ERROR', msg: 'invalid JSON' }));
        return;
      }

      // First message must be JOIN or RESUME
      if (!client) {
        if (msg.t === 'JOIN' || msg.t === 'RESUME') {
          const sanitized = sanitizeName(msg.name);
          clientCid = msg.cid;
          client = room.addClient(ws, sanitized, msg.cid);
          room.handleMessage(client, str);
        } else {
          ws.send(JSON.stringify({ t: 'ERROR', msg: 'must JOIN first' }));
        }
        return;
      }

      room.handleMessage(client, str);
    });

    ws.on('close', () => {
      clearInterval(pingTimer);
      if (client) {
        room.removeClient(client.u, clientCid, ws);
      }
    });
  });

  httpServer.listen(requestedPort);
  const addr = httpServer.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : requestedPort;

  // Persistence timer
  let dirty = false;
  let persistTimer: ReturnType<typeof setInterval> | null = null;

  if (persist) {
    // Watch for version changes to mark dirty
    const origHandleEdit = room.handleEdit.bind(room);
    const wrappedHandleMessage = room.handleMessage.bind(room);
    // Use a proxy approach: mark dirty after each EDIT
    let lastVersion = room.getVersion();

    persistTimer = setInterval(() => {
      const currentV = room.getVersion();
      if (currentV !== lastVersion) {
        dirty = true;
        lastVersion = currentV;
      }
      if (dirty) {
        saveState(dataDir, room.getVersion(), room.getRaw());
        dirty = false;
      }
    }, PERSIST_INTERVAL);

    // Save on exit signals
    const onExit = () => {
      if (room.getVersion() !== lastVersion || dirty) {
        saveState(dataDir, room.getVersion(), room.getRaw());
      }
    };
    process.on('SIGINT', () => { onExit(); process.exit(0); });
    process.on('SIGTERM', () => { onExit(); process.exit(0); });
  }

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      if (persistTimer) clearInterval(persistTimer);
      for (const ws of wss.clients) {
        ws.terminate();
      }
      wss.close(() => {
        httpServer.close(() => resolve());
      });
    });

  return { close, port: actualPort, room };
}

// ── Default startup ──

const isMain = typeof process !== 'undefined' && process.argv[1] && (
  process.argv[1].endsWith('server\\index.ts') ||
  process.argv[1].endsWith('server/index.ts') ||
  process.argv[1].endsWith('server\\index.js') ||
  process.argv[1].endsWith('server/index.js')
);

if (isMain && process.env['NODE_ENV'] !== 'test' && !process.env['SPREADSHEET_LIB']) {
  const PORT = parseInt(process.env['PORT'] || '8787', 10);
  const handle = startServer({ port: PORT, persist: true });
  console.log(`Server listening on port ${handle.port}`);
}
