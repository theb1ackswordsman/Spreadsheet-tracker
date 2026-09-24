import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Room } from './room';
import type { S2C, C2S } from '../shared/protocol';

/** Start an in-process server on a random port, return cleanup fn */
function startServer(): { port: number; cleanup: () => Promise<void>; room: Room } {
  const room = new Room('integration');
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

  const port = 0; // random
  httpServer.listen(port);
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

/** Connect a ws client and wait for a message matching a predicate */
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
    // Check existing messages first
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

describe('integration: two clients', () => {
  const { port, cleanup } = startServer();
  afterAll(() => cleanup());

  it('both clients receive identical OP sequences with increasing v', async () => {
    const c1 = connectClient(port);
    const c2 = connectClient(port);

    // Wait for both to be open
    await new Promise<void>((r) => { c1.ws.on('open', r); });
    await new Promise<void>((r) => { c2.ws.on('open', r); });

    // Both JOIN
    sendMsg(c1.ws, { t: 'JOIN', sheetId: 'integration', name: 'Alice', cid: 'cid-alice' });
    sendMsg(c2.ws, { t: 'JOIN', sheetId: 'integration', name: 'Bob', cid: 'cid-bob' });

    // Wait for snapshots
    await c1.waitFor((m) => m.t === 'SNAPSHOT');
    await c2.waitFor((m) => m.t === 'SNAPSHOT');

    // Both edit the same cell
    sendMsg(c1.ws, { t: 'EDIT', opId: 1, edits: [{ cell: 'A1', raw: 'fromAlice' }] });
    sendMsg(c2.ws, { t: 'EDIT', opId: 1, edits: [{ cell: 'A1', raw: 'fromBob' }] });

    // Wait until both have received 2 OP messages
    await c1.waitFor(() => c1.messages.filter((m) => m.t === 'OP').length >= 2);
    await c2.waitFor(() => c2.messages.filter((m) => m.t === 'OP').length >= 2);

    const c1Ops = c1.messages.filter((m): m is Extract<S2C, { t: 'OP' }> => m.t === 'OP');
    const c2Ops = c2.messages.filter((m): m is Extract<S2C, { t: 'OP' }> => m.t === 'OP');

    // Both see exactly 2 ops
    expect(c1Ops.length).toBe(2);
    expect(c2Ops.length).toBe(2);

    // Versions are strictly increasing
    expect(c1Ops[0]!.op.v).toBeLessThan(c1Ops[1]!.op.v);
    expect(c2Ops[0]!.op.v).toBeLessThan(c2Ops[1]!.op.v);

    // Both see the same version sequence
    expect(c1Ops[0]!.op.v).toBe(c2Ops[0]!.op.v);
    expect(c1Ops[1]!.op.v).toBe(c2Ops[1]!.op.v);

    // Both end up with the same final value (highest v wins)
    const lastOp = c1Ops[1]!.op;
    const lastRaw = lastOp.edits[0]!.raw;

    // c2 should see the same final value
    const c2Last = c2Ops[1]!.op;
    expect(c2Last.edits[0]!.raw).toBe(lastRaw);

    // Cleanup
    c1.ws.close();
    c2.ws.close();
  });
});
