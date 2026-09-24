import http from 'node:http';
import { WebSocketServer } from 'ws';
import { getRoom, type Client } from './room';
import type { C2S } from '../shared/protocol';

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
});

const wss = new WebSocketServer({ server, path: '/ws' });

// Ping interval for liveness
const PING_INTERVAL = 15_000;

wss.on('connection', (ws) => {
  let client: Client | null = null;
  let room: ReturnType<typeof getRoom> | null = null;
  let alive = true;
  let clientCid: string | undefined;

  ws.on('pong', () => { alive = true; });

  const pingTimer = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, PING_INTERVAL);

  ws.on('message', (data) => {
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
        const sheetId = msg.sheetId || 'main';
        room = getRoom(sheetId);
        clientCid = msg.cid;
        client = room.addClient(ws, msg.name, msg.cid);
        room.handleMessage(client, str);
      } else {
        ws.send(JSON.stringify({ t: 'ERROR', msg: 'must JOIN first' }));
      }
      return;
    }

    room!.handleMessage(client, str);
  });

  ws.on('close', () => {
    clearInterval(pingTimer);
    if (client && room) {
      room.removeClient(client.u, clientCid);
    }
  });
});

export { server, wss };

const PORT = parseInt(process.env['PORT'] || '8787', 10);
if (process.env['NODE_ENV'] !== 'test') {
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}
