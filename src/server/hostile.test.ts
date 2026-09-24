import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { WebSocket } from 'ws';
import { startServer, type ServerHandle } from './index';
import type { S2C, C2S } from '../shared/protocol';

let server: ServerHandle;

beforeAll(() => {
  process.env['SPREADSHEET_LIB'] = '1';
  server = startServer({ port: 0, persist: false });
});

afterAll(async () => {
  await server.close();
});

function connect(): {
  ws: WebSocket;
  messages: S2C[];
  waitFor: (pred: (m: S2C) => boolean, timeout?: number) => Promise<S2C>;
} {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  const messages: S2C[] = [];
  const waiters: Array<{ pred: (m: S2C) => boolean; resolve: (m: S2C) => void }> = [];

  ws.on('error', () => {});

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

function send(ws: WebSocket, msg: C2S): void {
  ws.send(JSON.stringify(msg));
}

async function waitOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return;
  return new Promise((r) => ws.on('open', r));
}

/** Helper: connect a "victim" client that should keep working after hostile tests */
async function connectVictim(): Promise<{ ws: WebSocket; messages: S2C[]; waitFor: (pred: (m: S2C) => boolean, timeout?: number) => Promise<S2C> }> {
  const c = connect();
  await waitOpen(c.ws);
  send(c.ws, { t: 'JOIN', sheetId: 'main', name: 'Victim', cid: 'victim-' + Date.now() });
  await c.waitFor(m => m.t === 'SNAPSHOT');
  return c;
}

/** Verify server still serving by doing a basic edit round-trip */
async function assertServerAlive(): Promise<void> {
  const c = connect();
  await waitOpen(c.ws);
  send(c.ws, { t: 'JOIN', sheetId: 'main', name: 'Probe', cid: 'probe-' + Date.now() });
  const snap = await c.waitFor(m => m.t === 'SNAPSHOT');
  expect(snap.t).toBe('SNAPSHOT');

  send(c.ws, { t: 'EDIT', opId: 1, edits: [{ cell: 'A1', raw: 'alive' }] });
  const op = await c.waitFor(m => m.t === 'OP');
  expect(op.t).toBe('OP');
  c.ws.close();
}

describe('hostile input', () => {
  it('rejects cell id "__proto__"', async () => {
    const c = await connectVictim();
    send(c.ws, { t: 'EDIT', opId: 1, edits: [{ cell: '__proto__', raw: '42' }] });
    const err = await c.waitFor(m => m.t === 'ERROR');
    expect(err.t).toBe('ERROR');
    c.ws.close();
    await assertServerAlive();
  });

  it('rejects cell id "A99999"', async () => {
    const c = await connectVictim();
    send(c.ws, { t: 'EDIT', opId: 1, edits: [{ cell: 'A99999', raw: '42' }] });
    const err = await c.waitFor(m => m.t === 'ERROR');
    expect(err.t).toBe('ERROR');
    c.ws.close();
    await assertServerAlive();
  });

  it('rejects cell id "AAA1"', async () => {
    const c = await connectVictim();
    send(c.ws, { t: 'EDIT', opId: 1, edits: [{ cell: 'AAA1', raw: '42' }] });
    const err = await c.waitFor(m => m.t === 'ERROR');
    expect(err.t).toBe('ERROR');
    c.ws.close();
    await assertServerAlive();
  });

  it('disconnects client sending oversized message; server keeps serving', async () => {
    const big = connect();
    await waitOpen(big.ws);
    send(big.ws, { t: 'JOIN', sheetId: 'main', name: 'BigSender', cid: 'big-' + Date.now() });
    await big.waitFor(m => m.t === 'SNAPSHOT');

    // Send a payload over 256 KB limit — server should terminate the connection
    const hugeRaw = 'x'.repeat(300 * 1024);
    const donePromise = new Promise<void>((r) => {
      big.ws.on('close', () => r());
      big.ws.on('error', () => r());
    });
    try {
      big.ws.send(JSON.stringify({ t: 'EDIT', opId: 1, edits: [{ cell: 'A1', raw: hugeRaw }] }));
    } catch {
      // may throw synchronously
    }
    await donePromise;

    // Server still alive
    await assertServerAlive();
  });

  it('rejects 5001 edits in one message', async () => {
    const c = await connectVictim();
    const edits: Array<{ cell: string; raw: string }> = [];
    for (let i = 0; i < 5001; i++) {
      edits.push({ cell: 'A1', raw: String(i) });
    }
    send(c.ws, { t: 'EDIT', opId: 1, edits });
    const err = await c.waitFor(m => m.t === 'ERROR');
    expect(err.t).toBe('ERROR');
    c.ws.close();
    await assertServerAlive();
  });
});
