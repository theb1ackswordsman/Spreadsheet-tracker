import http from 'node:http';
import { WebSocketServer } from 'ws';

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('connect');
  ws.on('close', () => {
    console.log('disconnect');
  });
});

const PORT = 8787;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
