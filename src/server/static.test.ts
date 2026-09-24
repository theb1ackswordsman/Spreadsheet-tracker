import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, type ServerHandle } from './index';

let server: ServerHandle;

beforeAll(() => {
  process.env['SPREADSHEET_LIB'] = '1';
  // Create a minimal dist/ with an index.html for the test
  const distDir = path.resolve('dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html></html>');
  }
  server = startServer({ port: 0, persist: false, serveStatic: true });
});

afterAll(async () => {
  await server.close();
});

function get(urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${server.port}${urlPath}`, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

/** Send a raw HTTP request to bypass Node's URL normalization */
function rawGet(rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port: server.port }, () => {
      sock.write(`GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    sock.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    sock.on('end', () => {
      const statusMatch = /HTTP\/1\.1 (\d+)/.exec(data);
      const status = statusMatch ? parseInt(statusMatch[1]!, 10) : 0;
      const bodyStart = data.indexOf('\r\n\r\n');
      const body = bodyStart >= 0 ? data.slice(bodyStart + 4) : '';
      resolve({ status, body });
    });
    sock.on('error', reject);
  });
}

describe('static serving traversal protection', () => {
  it('blocks /../package.json via raw request', async () => {
    const res = await rawGet('/../package.json');
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('spreadsheet-ai-kit');
  });

  it('blocks encoded /%2e%2e/package.json', async () => {
    const res = await rawGet('/%2e%2e/package.json');
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('spreadsheet-ai-kit');
  });

  it('blocks /..%2fpackage.json', async () => {
    const res = await rawGet('/..%2fpackage.json');
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('spreadsheet-ai-kit');
  });

  it('returns 404 for missing asset with extension', async () => {
    const res = await get('/no-such-file.js');
    expect(res.status).toBe(404);
  });

  it('/debug/hash still works', async () => {
    const res = await get('/debug/hash');
    expect(res.status).toBe(200);
    expect(res.body).toContain('hash');
  });

  it('SPA fallback serves index.html for extensionless paths', async () => {
    const res = await get('/some/route');
    expect(res.status).toBe(200);
    expect(res.body).toContain('<html');
  });
});
