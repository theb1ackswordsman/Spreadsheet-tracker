import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Room } from './room';
import type { S2C, C2S } from '../shared/protocol';

/** Start an in-process server on a random port */
function startServer(): { port: number; cleanup: () => Promise<void>; room: Room } {
  const room = new Room('p4-test');
  const httpServer = http.createServer();
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    let client: ReturnType<typeof room.addClient> | null = null;
    let clientCid: string | undefined;

    ws.on('message', (data) => {
      const str = typeof data === 'string' ? data : data.toString('utf8');
      const msg = JSON.parse(str) as C2S;

      if (!client) {
        if (msg.t === 'JOIN' || msg.t === 'RESUME') {
          clientCid = msg.cid;
          client = room.addClient(ws, msg.name, msg.cid);
          room.handleMessage(client, str);
        }
        return;
      }
      room.handleMessage(client, str);
    });

    ws.on('close', () => {
      if (client) room.removeClient(client.u, clientCid);
    });
  });

  httpServer.listen(0);
  const addr = httpServer.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : 0;

  const cleanup = (): Promise<void> =>
    new Promise((resolve) => {
      wss.close(() => {
        httpServer.close(() => resolve());
      });
    });

  return { port: actualPort, cleanup, room };
}

/** Connect a ws client and collect messages */
function connectClient(port: number): {
  ws: WebSocket;
  messages: S2C[];
  waitFor: (pred: (m: S2C) => boolean, timeout?: number) => Promise<S2C>;
} {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages: S2C[] = [];
  const waiters: Array<{ pred: (m: S2C) => boolean; resolve: (m: S2C) => void }> = [];

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as S2C;
    messages.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.pred(msg)) {
        waiters[i]!.resolve(msg);
        waiters.splice(i, 1);
      }
    }
  });

  const waitFor = (pred: (m: S2C) => boolean, timeout = 3000): Promise<S2C> => {
    const existing = messages.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('waitFor timeout')), timeout);
      waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  };

  return { ws, messages, waitFor };
}

function sendMsg(ws: WebSocket, msg: C2S): void {
  ws.send(JSON.stringify(msg));
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((r) => { ws.on('open', r); });
}

function waitClose(ws: WebSocket): Promise<void> {
  return new Promise((r) => { ws.on('close', r); });
}

describe('P4: reconnect with cid dedupe', () => {
  const { port, cleanup, room } = startServer();
  afterAll(() => cleanup());

  it('reconnect with same cid reuses u and lastOpId; replayed opId is ignored', async () => {
    const CID = 'test-cid-reconnect';
    const c1 = connectClient(port);
    await waitOpen(c1.ws);

    // JOIN
    sendMsg(c1.ws, { t: 'JOIN', sheetId: 'p4-test', name: 'Alice', cid: CID });
    const snap = await c1.waitFor(m => m.t === 'SNAPSHOT') as Extract<S2C, { t: 'SNAPSHOT' }>;
    const u1 = snap.you.u;

    // Edit
    sendMsg(c1.ws, { t: 'EDIT', opId: 1, edits: [{ cell: 'A1', raw: 'hello' }] });
    await c1.waitFor(m => m.t === 'OP');
    expect(room.getVersion()).toBe(1);

    // Disconnect
    c1.ws.close();
    await waitClose(c1.ws);

    // Reconnect with same cid
    const c2 = connectClient(port);
    await waitOpen(c2.ws);

    sendMsg(c2.ws, { t: 'RESUME', sheetId: 'p4-test', name: 'Alice', lastVersion: 1, cid: CID });
    const opsMsg = await c2.waitFor(m => m.t === 'OPS' || m.t === 'SNAPSHOT');

    // Should get empty OPS since lastVersion matches
    if (opsMsg.t === 'OPS') {
      expect((opsMsg as Extract<S2C, { t: 'OPS' }>).ops.length).toBe(0);
    }

    // Replay same opId=1 (should be ignored, version stays at 1)
    sendMsg(c2.ws, { t: 'EDIT', opId: 1, edits: [{ cell: 'A1', raw: 'world' }] });

    // Send a new edit to confirm the connection works
    sendMsg(c2.ws, { t: 'EDIT', opId: 2, edits: [{ cell: 'A2', raw: 'new' }] });
    const op2 = await c2.waitFor(m => m.t === 'OP' && (m as Extract<S2C, { t: 'OP' }>).op.v === 2);

    // Version should be 2 (not 3), proving opId=1 was deduped
    expect(room.getVersion()).toBe(2);
    expect(room.getRaw().get('A1')).toBe('hello'); // Not 'world'
    expect(room.getRaw().get('A2')).toBe('new');

    // The user id should be the same
    const op = (op2 as Extract<S2C, { t: 'OP' }>).op;
    expect(op.u).toBe(u1);

    c2.ws.close();
  });
});

describe('P4: RESUME with lastVersion > server version returns SNAPSHOT', () => {
  const { port, cleanup } = startServer();
  afterAll(() => cleanup());

  it('sends SNAPSHOT when client lastVersion exceeds server version', async () => {
    const c = connectClient(port);
    await waitOpen(c.ws);

    // RESUME with lastVersion=999 > server version 0
    sendMsg(c.ws, { t: 'RESUME', sheetId: 'p4-test', name: 'Bob', lastVersion: 999, cid: 'cid-future' });
    const msg = await c.waitFor(m => m.t === 'SNAPSHOT');
    expect(msg.t).toBe('SNAPSHOT');
    const snap = msg as Extract<S2C, { t: 'SNAPSHOT' }>;
    expect(snap.v).toBe(0);

    c.ws.close();
  });
});

describe('P4: presence removal on close', () => {
  const { port, cleanup, room } = startServer();
  afterAll(() => cleanup());

  it('removes user from presence on disconnect', async () => {
    const c1 = connectClient(port);
    const c2 = connectClient(port);
    await waitOpen(c1.ws);
    await waitOpen(c2.ws);

    sendMsg(c1.ws, { t: 'JOIN', sheetId: 'p4-test', name: 'Alice', cid: 'cid-a' });
    sendMsg(c2.ws, { t: 'JOIN', sheetId: 'p4-test', name: 'Bob', cid: 'cid-b' });
    await c1.waitFor(m => m.t === 'SNAPSHOT');
    await c2.waitFor(m => m.t === 'SNAPSHOT');

    // Wait for presence with both users
    await c2.waitFor(m => {
      if (m.t !== 'PRESENCE') return false;
      return (m as Extract<S2C, { t: 'PRESENCE' }>).users.length >= 2;
    });

    expect(room.getClientCount()).toBe(2);

    // Disconnect c1
    c1.ws.close();
    await waitClose(c1.ws);

    // c2 should receive a PRESENCE update with only 1 user
    const presMsg = await c2.waitFor(m => {
      if (m.t !== 'PRESENCE') return false;
      return (m as Extract<S2C, { t: 'PRESENCE' }>).users.length === 1;
    });
    const users = (presMsg as Extract<S2C, { t: 'PRESENCE' }>).users;
    expect(users.length).toBe(1);
    expect(users[0]!.name).toBe('Bob');

    c2.ws.close();
  });
});

describe('P4: throttle SELECTs into fewer PRESENCE broadcasts', () => {
  const { port, cleanup } = startServer();
  afterAll(() => cleanup());

  it('a burst of SELECTs yields far fewer PRESENCE broadcasts', async () => {
    const c1 = connectClient(port);
    const c2 = connectClient(port);
    await waitOpen(c1.ws);
    await waitOpen(c2.ws);

    sendMsg(c1.ws, { t: 'JOIN', sheetId: 'p4-test', name: 'Alice', cid: 'cid-t1' });
    sendMsg(c2.ws, { t: 'JOIN', sheetId: 'p4-test', name: 'Bob', cid: 'cid-t2' });
    await c1.waitFor(m => m.t === 'SNAPSHOT');
    await c2.waitFor(m => m.t === 'SNAPSHOT');

    // Wait for initial PRESENCE to settle
    await new Promise(r => setTimeout(r, 100));
    const presenceBefore = c2.messages.filter(m => m.t === 'PRESENCE').length;

    // Burst: send 20 SELECTs rapidly
    const cells = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5',
                   'C1', 'C2', 'C3', 'C4', 'C5', 'D1', 'D2', 'D3', 'D4', 'D5'];
    for (const cell of cells) {
      sendMsg(c1.ws, { t: 'SELECT', cell });
    }

    // Wait for throttle to flush
    await new Promise(r => setTimeout(r, 200));

    const presenceAfter = c2.messages.filter(m => m.t === 'PRESENCE').length;
    const newPresence = presenceAfter - presenceBefore;

    // 20 SELECTs should result in far fewer than 20 PRESENCE broadcasts due to throttling
    expect(newPresence).toBeGreaterThan(0);
    expect(newPresence).toBeLessThan(10);

    c1.ws.close();
    c2.ws.close();
  });
});
