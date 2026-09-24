import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Room, type Client } from './room';
import type { C2S } from '../shared/protocol';
import { cellsHash } from '../shared/hash';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SessionManager,
  RateLimiter,
  parseCookies,
  getSessionFromRequest,
  buildSetCookie,
  buildClearCookie,
  checkCsrfAndOrigin,
  isLoopback,
  readJsonBody,
  defaultVerifyGoogleCode,
  type VerifyGoogleCodeFn,
} from './auth';
import {
  SheetManager,
  roleFor,
  isValidEmail,
  validateAcl,
} from './sheets';

// ── MIME types for static serving ──

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

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
    const list = allowed.split(',').map((s) => s.trim());
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

// ── Persistence for legacy/auth:off ──

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
  serveStatic?: boolean;
  auth?: 'on' | 'off';
  verifyGoogleCode?: VerifyGoogleCodeFn;
  dataDir?: string;
}

export interface ServerHandle {
  close: () => Promise<void>;
  port: number;
  room: Room;
  sheetManager?: SheetManager;
  sessionManager?: SessionManager;
}

export function startServer(opts: ServerOptions = {}): ServerHandle {
  const persist = opts.persist ?? false;
  const serveStatic = opts.serveStatic ?? false;
  const authMode = opts.auth ?? 'off';
  const requestedPort = opts.port ?? 0;
  const dataDir = opts.dataDir ? path.resolve(opts.dataDir) : path.resolve('data');
  const distRoot = serveStatic ? path.resolve('dist') : null;

  // Single fallback/legacy room (used in auth: 'off' mode and tests)
  const room = new Room('main');

  // Managers for auth mode
  let sessionManager: SessionManager | undefined;
  let sheetManager: SheetManager | undefined;
  let authRateLimiter: RateLimiter | undefined;
  let sheetsRateLimiter: RateLimiter | undefined;
  const verifyGoogleCode = opts.verifyGoogleCode ?? defaultVerifyGoogleCode;
  let guestCounter = 0;

  if (authMode === 'on') {
    sessionManager = new SessionManager(dataDir, persist);
    sheetManager = new SheetManager(dataDir, persist);
    authRateLimiter = new RateLimiter(10, 60 * 1000); // 10/min/IP
    sheetsRateLimiter = new RateLimiter(20, 60 * 60 * 1000); // 20/hr/user
  } else if (persist) {
    // Load persisted state for legacy single room
    const state = loadState(dataDir);
    if (state) {
      room.loadState(state.v, state.cells);
    }
  }

  // HTTP server
  const httpServer = http.createServer(async (req, res) => {
    const rawUrl = (req.url ?? '/').split('?')[0] ?? '/';

    // /debug/hash
    if (req.method === 'GET' && rawUrl === '/debug/hash') {
      const v = room.getVersion();
      const hash = cellsHash(room.getRaw());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ v, hash }));
      return;
    }

    // Auth & Sheets REST API
    if (authMode === 'on' && rawUrl.startsWith('/api/')) {
      // CSRF & Origin checks on non-GET
      if (req.method !== 'GET') {
        const csrf = checkCsrfAndOrigin(req);
        if (!csrf.ok) {
          res.writeHead(csrf.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: csrf.error }));
          return;
        }
      }

      // GET /api/config
      if (req.method === 'GET' && rawUrl === '/api/config') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            googleClientId: process.env['GOOGLE_CLIENT_ID'] || '',
            devLogin: process.env['ALLOW_DEV_LOGIN'] === '1',
          })
        );
        return;
      }

      // GET /api/me
      if (req.method === 'GET' && rawUrl === '/api/me') {
        const user = getSessionFromRequest(req, sessionManager!);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: user ? { email: user.email, name: user.name } : null }));
        return;
      }

      // Rate limit for /api/auth/*
      if (rawUrl.startsWith('/api/auth/')) {
        const clientIp = req.socket.remoteAddress || 'unknown';
        if (!authRateLimiter!.isAllowed(clientIp)) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'rate_limited' }));
          return;
        }
      }

      // POST /api/auth/google
      if (req.method === 'POST' && rawUrl === '/api/auth/google') {
        const bodyRes = await readJsonBody(req);
        if (!bodyRes.ok) {
          res.writeHead(bodyRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: bodyRes.error }));
          return;
        }
        const { code } = bodyRes.body ?? {};
        if (!code || typeof code !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad_request' }));
          return;
        }

        let verified: { email: string; name: string; email_verified?: boolean } | null = null;
        try {
          verified = await verifyGoogleCode(code);
        } catch {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_token' }));
          return;
        }

        if (!verified || verified.email_verified !== true) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'email_not_verified' }));
          return;
        }

        const email = verified.email.toLowerCase().trim();
        const name = sanitizeName(verified.name || email.split('@')[0] || 'Guest');
        const sid = sessionManager!.createSession({ email, name });
        const cookie = buildSetCookie(sid, req);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': cookie,
        });
        res.end(JSON.stringify({ user: { email, name } }));
        return;
      }

      // POST /api/auth/logout
      if (req.method === 'POST' && rawUrl === '/api/auth/logout') {
        const cookies = parseCookies(req.headers['cookie']);
        const sid = cookies['sid'];
        if (sid) {
          sessionManager!.deleteSession(sid);
        }
        const cookie = buildClearCookie(req);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': cookie,
        });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // POST /api/auth/dev
      if (req.method === 'POST' && rawUrl === '/api/auth/dev') {
        if (process.env['ALLOW_DEV_LOGIN'] !== '1' || !isLoopback(req.socket.remoteAddress)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden' }));
          return;
        }
        const bodyRes = await readJsonBody(req);
        if (!bodyRes.ok) {
          res.writeHead(bodyRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: bodyRes.error }));
          return;
        }
        const { email, name: rawName } = bodyRes.body ?? {};
        if (!isValidEmail(email)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad_request' }));
          return;
        }
        const cleanEmail = email.toLowerCase().trim();
        const cleanName = sanitizeName(rawName || cleanEmail.split('@')[0]);
        const sid = sessionManager!.createSession({ email: cleanEmail, name: cleanName });
        const cookie = buildSetCookie(sid, req);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': cookie,
        });
        res.end(JSON.stringify({ user: { email: cleanEmail, name: cleanName } }));
        return;
      }

      // POST /api/sheets
      if (req.method === 'POST' && rawUrl === '/api/sheets') {
        const user = getSessionFromRequest(req, sessionManager!);
        if (!user) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'signin_required' }));
          return;
        }
        if (!sheetsRateLimiter!.isAllowed(user.email.toLowerCase())) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'rate_limited' }));
          return;
        }
        const meta = sheetManager!.createSheet(user.email);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: meta.id }));
        return;
      }

      // GET /api/sheets
      if (req.method === 'GET' && rawUrl === '/api/sheets') {
        const user = getSessionFromRequest(req, sessionManager!);
        if (!user) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'signin_required' }));
          return;
        }
        const sheets = sheetManager!.getRecentSheets(user.email);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(sheets));
        return;
      }

      // GET /api/sheets/:id
      const sheetGetMatch = rawUrl.match(/^\/api\/sheets\/([a-zA-Z0-9_-]+)$/);
      if (req.method === 'GET' && sheetGetMatch) {
        const sheetId = sheetGetMatch[1]!;
        const meta = sheetManager!.getSheetMeta(sheetId);
        const user = getSessionFromRequest(req, sessionManager!);
        if (!meta) {
          if (!user) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'signin_required' }));
          } else {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'forbidden' }));
          }
          return;
        }
        const role = roleFor(meta, user);
        if (role === null) {
          if (!user) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'signin_required' }));
          } else {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'forbidden' }));
          }
          return;
        }
        const resObj: Record<string, unknown> = {
          id: meta.id,
          title: meta.title,
          role,
          visibility: meta.visibility,
          publicRole: meta.publicRole,
        };
        if (role === 'owner') {
          resObj['acl'] = meta.acl;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resObj));
        return;
      }

      // PATCH /api/sheets/:id
      const sheetPatchMatch = rawUrl.match(/^\/api\/sheets\/([a-zA-Z0-9_-]+)$/);
      if (req.method === 'PATCH' && sheetPatchMatch) {
        const sheetId = sheetPatchMatch[1]!;
        const user = getSessionFromRequest(req, sessionManager!);
        if (!user) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'signin_required' }));
          return;
        }
        const meta = sheetManager!.getSheetMeta(sheetId);
        if (!meta) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden' }));
          return;
        }
        const role = roleFor(meta, user);
        if (role !== 'owner' && role !== 'editor') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden' }));
          return;
        }
        const bodyRes = await readJsonBody(req);
        if (!bodyRes.ok) {
          res.writeHead(bodyRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: bodyRes.error }));
          return;
        }
        const updateRes = sheetManager!.updateTitle(sheetId, bodyRes.body?.title);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updateRes));
        return;
      }

      // PUT /api/sheets/:id/share
      const sheetShareMatch = rawUrl.match(/^\/api\/sheets\/([a-zA-Z0-9_-]+)\/share$/);
      if (req.method === 'PUT' && sheetShareMatch) {
        const sheetId = sheetShareMatch[1]!;
        const user = getSessionFromRequest(req, sessionManager!);
        if (!user) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'signin_required' }));
          return;
        }
        const meta = sheetManager!.getSheetMeta(sheetId);
        if (!meta) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden' }));
          return;
        }
        const role = roleFor(meta, user);
        if (role !== 'owner') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden' }));
          return;
        }
        const bodyRes = await readJsonBody(req);
        if (!bodyRes.ok) {
          res.writeHead(bodyRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: bodyRes.error }));
          return;
        }
        const { visibility, publicRole, acl } = bodyRes.body ?? {};
        if (visibility !== 'restricted' && visibility !== 'public') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad_request' }));
          return;
        }
        if (publicRole !== 'viewer' && publicRole !== 'editor') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad_request' }));
          return;
        }
        const validatedAcl = validateAcl(acl);
        if (validatedAcl === null) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad_request' }));
          return;
        }
        const shareRes = sheetManager!.updateShare(
          sheetId,
          visibility,
          publicRole,
          validatedAcl
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(shareRes));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    // Static file serving when enabled
    if (distRoot && req.method === 'GET') {
      const decoded = decodeURIComponent(rawUrl);
      const resolved = path.resolve(distRoot, '.' + decoded);

      // Path traversal protection
      if (!resolved.startsWith(distRoot + path.sep) && resolved !== distRoot) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      const ext = path.extname(resolved);

      // Try serving the resolved file
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        fs.createReadStream(resolved).pipe(res);
        return;
      }

      // 404 for missing files with an extension (known asset)
      if (ext) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      // SPA fallback: serve index.html for paths without extension
      const indexPath = path.join(distRoot, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        fs.createReadStream(indexPath).pipe(res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
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

    const sessionUser = authMode === 'on' ? getSessionFromRequest(req, sessionManager!) : null;
    let client: Client | null = null;
    let clientCid: string | undefined;
    let currentRoom: Room | null = null;
    let currentSheetId: string | undefined;
    let alive = true;
    const bucket = newBucket();

    ws.on('pong', () => {
      alive = true;
    });

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
        ws.send(JSON.stringify({ t: 'ERROR', code: 'bad_request', msg: 'invalid JSON' }));
        return;
      }

      // First message must be JOIN or RESUME
      if (!client) {
        if (msg.t === 'JOIN' || msg.t === 'RESUME') {
          clientCid = msg.cid;
          if (authMode === 'off') {
            const sanitized = sanitizeName(msg.name);
            client = room.addClient(ws, sanitized, msg.cid);
            currentRoom = room;
            room.handleMessage(client, str);
          } else {
            const sheetId = msg.sheetId || 'main';
            const targetRoom = sheetManager!.getOrCreateRoom(sheetId);
            if (!targetRoom) {
              ws.send(JSON.stringify({ t: 'ERROR', code: 'forbidden', msg: 'sheet not found' }));
              ws.close(4403, 'forbidden');
              return;
            }
            const meta = targetRoom.getMeta();
            const role = meta ? roleFor(meta, sessionUser) : null;
            if (role === null) {
              if (sessionUser === null) {
                ws.send(
                  JSON.stringify({
                    t: 'ERROR',
                    code: 'signin_required',
                    msg: 'sign in required',
                  })
                );
                ws.close(4403, 'signin_required');
              } else {
                ws.send(
                  JSON.stringify({
                    t: 'ERROR',
                    code: 'forbidden',
                    msg: 'forbidden',
                  })
                );
                ws.close(4403, 'forbidden');
              }
              return;
            }

            let name: string;
            if (sessionUser) {
              name = sanitizeName(sessionUser.name);
            } else {
              guestCounter++;
              name = `Guest ${guestCounter}`;
            }

            client = targetRoom.addClient(ws, name, msg.cid, role, sessionUser);
            currentRoom = targetRoom;
            currentSheetId = sheetId;
            targetRoom.handleMessage(client, str);
          }
        } else {
          ws.send(JSON.stringify({ t: 'ERROR', code: 'bad_request', msg: 'must JOIN first' }));
        }
        return;
      }

      currentRoom!.handleMessage(client, str);
    });

    ws.on('close', () => {
      clearInterval(pingTimer);
      if (client && currentRoom) {
        currentRoom.removeClient(client.u, clientCid, ws);
      }
      if (currentSheetId && authMode === 'on') {
        sheetManager!.onClientLeaveRoom(currentSheetId);
      }
    });
  });

  httpServer.listen(requestedPort);
  const addr = httpServer.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : requestedPort;

  // Persistence timer for legacy mode
  let dirty = false;
  let persistTimer: ReturnType<typeof setInterval> | null = null;

  if (authMode === 'off' && persist) {
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

    const onExit = () => {
      if (room.getVersion() !== lastVersion || dirty) {
        saveState(dataDir, room.getVersion(), room.getRaw());
      }
    };
    process.on('SIGINT', () => {
      onExit();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      onExit();
      process.exit(0);
    });
  }

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      if (persistTimer) clearInterval(persistTimer);
      if (sheetManager) sheetManager.destroy();
      if (sessionManager) sessionManager.destroy();
      for (const ws of wss.clients) {
        ws.terminate();
      }
      wss.close(() => {
        httpServer.close(() => resolve());
      });
    });

  return { close, port: actualPort, room, sheetManager, sessionManager };
}

// ── Default startup ──

const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('server\\index.ts') ||
    process.argv[1].endsWith('server/index.ts') ||
    process.argv[1].endsWith('server\\index.js') ||
    process.argv[1].endsWith('server/index.js'));

if (isMain && process.env['NODE_ENV'] !== 'test' && !process.env['SPREADSHEET_LIB']) {
  const PORT = parseInt(process.env['PORT'] || '8787', 10);
  const useStatic = process.argv.includes('-static');
  const handle = startServer({ port: PORT, persist: true, serveStatic: useStatic, auth: 'on' });
  console.log(`Server listening on http://localhost:${handle.port}`);
}
