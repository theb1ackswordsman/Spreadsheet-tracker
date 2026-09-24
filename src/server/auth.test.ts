import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { WebSocket } from 'ws';
import { startServer, type ServerHandle } from './index';
import {
  SessionManager,
  buildSetCookie,
  checkCsrfAndOrigin,
  type SessionUser,
} from './auth';
import {
  roleFor,
  isValidEmail,
  validateAcl,
  type SheetMeta,
} from './sheets';
import type { S2C, C2S } from '../shared/protocol';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-auth-test-'));
}

function postJson(
  port: number,
  urlPath: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Host: `127.0.0.1:${port}`,
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed });
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function connectWs(
  port: number,
  cookie?: string
): {
  ws: WebSocket;
  messages: S2C[];
  waitFor: (pred: (m: S2C) => boolean, timeout?: number) => Promise<S2C>;
  waitForClose: (timeout?: number) => Promise<{ code: number; reason: string }>;
} {
  const headers: Record<string, string> = { Host: `127.0.0.1:${port}` };
  if (cookie) headers['Cookie'] = cookie;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  const messages: S2C[] = [];
  const waiters: Array<{ pred: (m: S2C) => boolean; resolve: (m: S2C) => void }> = [];
  let closeResult: { code: number; reason: string } | null = null;
  const closeWaiters: Array<(res: { code: number; reason: string }) => void> = [];

  ws.on('error', () => {});

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as S2C;
      messages.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i]!.pred(msg)) {
          waiters[i]!.resolve(msg);
          waiters.splice(i, 1);
        }
      }
    } catch {}
  });

  ws.on('close', (code, reason) => {
    closeResult = { code, reason: reason.toString() };
    for (const w of closeWaiters) {
      w(closeResult);
    }
    closeWaiters.length = 0;
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

  const waitForClose = (timeout = 3000): Promise<{ code: number; reason: string }> => {
    if (closeResult) return Promise.resolve(closeResult);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('waitForClose timeout')), timeout);
      closeWaiters.push((res) => {
        clearTimeout(timer);
        resolve(res);
      });
    });
  };

  return { ws, messages, waitFor, waitForClose };
}

describe('Auth & Sheets (P9a)', () => {
  let tempDir: string;
  let server: ServerHandle | undefined;

  beforeAll(() => {
    process.env['SPREADSHEET_LIB'] = '1';
    process.env['ALLOW_DEV_LOGIN'] = '1';
    tempDir = makeTempDir();
  });

  afterAll(async () => {
    if (server) await server.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('roleFor matrix (owner/acl/public/guest/none, highest wins)', () => {
    const meta: SheetMeta = {
      id: 'test-1',
      title: 'Test',
      owner: 'alice@example.com',
      visibility: 'restricted',
      publicRole: 'viewer',
      acl: [
        ['editor@example.com', 'editor'],
        ['viewer@example.com', 'viewer'],
      ],
      createdAt: 0,
      updatedAt: 0,
    };

    // Owner always owner
    expect(roleFor(meta, { email: 'alice@example.com', name: 'Alice' })).toBe('owner');
    expect(roleFor(meta, { email: 'ALICE@EXAMPLE.COM', name: 'Alice' })).toBe('owner');

    // ACL editor vs viewer
    expect(roleFor(meta, { email: 'editor@example.com', name: 'Bob' })).toBe('editor');
    expect(roleFor(meta, { email: 'viewer@example.com', name: 'Charlie' })).toBe('viewer');

    // Signed in stranger + restricted
    expect(roleFor(meta, { email: 'stranger@example.com', name: 'Eve' })).toBeNull();

    // Guest + restricted
    expect(roleFor(meta, null)).toBeNull();

    // Public sheet: highest wins
    const publicViewerMeta: SheetMeta = { ...meta, visibility: 'public', publicRole: 'viewer' };
    expect(roleFor(publicViewerMeta, null)).toBe('viewer');
    expect(roleFor(publicViewerMeta, { email: 'stranger@example.com', name: 'Eve' })).toBe('viewer');
    expect(roleFor(publicViewerMeta, { email: 'editor@example.com', name: 'Bob' })).toBe('editor'); // acl editor > public viewer

    const publicEditorMeta: SheetMeta = { ...meta, visibility: 'public', publicRole: 'editor' };
    expect(roleFor(publicEditorMeta, null)).toBe('editor');
    expect(roleFor(publicEditorMeta, { email: 'viewer@example.com', name: 'Charlie' })).toBe('editor'); // public editor > acl viewer
  });

  it('cookie flags (HttpOnly/SameSite=Lax/Secure under prod)', () => {
    const fakeReq = {
      headers: {},
    } as unknown as http.IncomingMessage;

    const cookieDev = buildSetCookie('test-sid', fakeReq);
    expect(cookieDev).toContain('HttpOnly');
    expect(cookieDev).toContain('SameSite=Lax');
    expect(cookieDev).toContain('Path=/');
    expect(cookieDev).toContain('Max-Age=604800');
    expect(cookieDev).not.toContain('Secure');

    const fakeHttpsReq = {
      headers: { 'x-forwarded-proto': 'https' },
    } as unknown as http.IncomingMessage;
    const cookieHttps = buildSetCookie('test-sid', fakeHttpsReq);
    expect(cookieHttps).toContain('Secure');

    const prevEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    const cookieProd = buildSetCookie('test-sid', fakeReq);
    expect(cookieProd).toContain('Secure');
    process.env['NODE_ENV'] = prevEnv;
  });

  it('cross-origin POST and missing X-Requested-With rejected', () => {
    const fakeNoXrw = {
      method: 'POST',
      headers: { origin: 'http://localhost:8787', host: 'localhost:8787' },
    } as unknown as http.IncomingMessage;
    const check1 = checkCsrfAndOrigin(fakeNoXrw);
    expect(check1.ok).toBe(false);

    const fakeBadOrigin = {
      method: 'POST',
      headers: {
        'x-requested-with': 'fetch',
        origin: 'https://evil.com',
        host: 'myhost.com',
      },
    } as unknown as http.IncomingMessage;
    const check2 = checkCsrfAndOrigin(fakeBadOrigin);
    expect(check2.ok).toBe(false);

    const fakeValid = {
      method: 'POST',
      headers: {
        'x-requested-with': 'fetch',
        origin: 'http://localhost:5173',
        host: 'localhost:8787',
      },
    } as unknown as http.IncomingMessage;
    const check3 = checkCsrfAndOrigin(fakeValid);
    expect(check3.ok).toBe(true);
  });

  it('acl size/email validation', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('invalid')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a'.repeat(250) + '@example.com')).toBe(false); // > 254 chars

    const validAcl = validateAcl([
      ['User@Example.com', 'editor'],
      ['viewer@example.com', 'viewer'],
    ]);
    expect(validAcl).toEqual([
      ['user@example.com', 'editor'],
      ['viewer@example.com', 'viewer'],
    ]);

    expect(validateAcl([['bademail', 'editor']])).toBeNull();
    expect(validateAcl([['user@example.com', 'invalidRole']])).toBeNull();
    expect(
      validateAcl([
        ['user@example.com', 'editor'],
        ['user@example.com', 'viewer'],
      ])
    ).toBeNull(); // duplicate

    const hugeAcl = Array.from({ length: 101 }, (_, i) => [`user${i}@example.com`, 'viewer']);
    expect(validateAcl(hugeAcl)).toBeNull(); // > 100 entries
  });

  it('session survives restart', () => {
    const sDir = path.join(tempDir, 'session-test');
    const mgr1 = new SessionManager(sDir, true);
    const sid = mgr1.createSession({ email: 'persist@example.com', name: 'Persist' });
    mgr1.save();
    mgr1.destroy();

    const mgr2 = new SessionManager(sDir, true);
    const user = mgr2.getSession(sid);
    expect(user).toEqual({ email: 'persist@example.com', name: 'Persist' });
    mgr2.destroy();
  });

  it('email_verified=false rejected', async () => {
    const mockVerify = async () => ({
      email: 'unverified@example.com',
      name: 'Unverified',
      email_verified: false,
    });

    const s = startServer({
      port: 0,
      persist: false,
      auth: 'on',
      verifyGoogleCode: mockVerify,
      dataDir: tempDir,
    });

    const res = await postJson(
      s.port,
      '/api/auth/google',
      { code: 'any-code' },
      {
        'X-Requested-With': 'fetch',
        Origin: `http://127.0.0.1:${s.port}`,
      }
    );

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('email_not_verified');
    await s.close();
  });

  it('restricted JOIN as guest -> signin_required+close, as signed-in stranger -> forbidden', async () => {
    const s = startServer({
      port: 0,
      persist: false,
      auth: 'on',
      dataDir: tempDir,
    });

    const sheet = s.sheetManager!.createSheet('owner@example.com');

    // 1. Guest join
    const guestConn = connectWs(s.port);
    await new Promise((r) => guestConn.ws.on('open', r));
    guestConn.ws.send(JSON.stringify({ t: 'JOIN', sheetId: sheet.id, name: '', cid: 'c1' }));

    const guestErr = await guestConn.waitFor((m) => m.t === 'ERROR');
    expect(guestErr).toMatchObject({ t: 'ERROR', code: 'signin_required' });
    const guestClose = await guestConn.waitForClose();
    expect(guestClose.code).toBe(4403);

    // 2. Signed-in stranger join
    const strangerSid = s.sessionManager!.createSession({
      email: 'stranger@example.com',
      name: 'Stranger',
    });
    const strangerConn = connectWs(s.port, `sid=${strangerSid}`);
    await new Promise((r) => strangerConn.ws.on('open', r));
    strangerConn.ws.send(JSON.stringify({ t: 'JOIN', sheetId: sheet.id, name: '', cid: 'c2' }));

    const strangerErr = await strangerConn.waitFor((m) => m.t === 'ERROR');
    expect(strangerErr).toMatchObject({ t: 'ERROR', code: 'forbidden' });
    const strangerClose = await strangerConn.waitForClose();
    expect(strangerClose.code).toBe(4403);

    await s.close();
  });

  it('viewer EDIT rejected (no version bump, fresh SNAPSHOT follows), editor EDIT works and reaches viewer', async () => {
    const s = startServer({
      port: 0,
      persist: false,
      auth: 'on',
      dataDir: tempDir,
    });

    const sheet = s.sheetManager!.createSheet('owner@example.com');
    s.sheetManager!.updateShare(sheet.id, 'restricted', 'viewer', [
      ['viewer@example.com', 'viewer'],
      ['editor@example.com', 'editor'],
    ]);

    const viewerSid = s.sessionManager!.createSession({
      email: 'viewer@example.com',
      name: 'Viewer Bob',
    });
    const editorSid = s.sessionManager!.createSession({
      email: 'editor@example.com',
      name: 'Editor Alice',
    });

    const viewerConn = connectWs(s.port, `sid=${viewerSid}`);
    const editorConn = connectWs(s.port, `sid=${editorSid}`);
    await Promise.all([
      new Promise((r) => viewerConn.ws.on('open', r)),
      new Promise((r) => editorConn.ws.on('open', r)),
    ]);

    viewerConn.ws.send(JSON.stringify({ t: 'JOIN', sheetId: sheet.id, name: '', cid: 'v1' }));
    editorConn.ws.send(JSON.stringify({ t: 'JOIN', sheetId: sheet.id, name: '', cid: 'e1' }));

    const viewerSnap = (await viewerConn.waitFor((m) => m.t === 'SNAPSHOT')) as Extract<S2C, { t: 'SNAPSHOT' }>;
    expect(viewerSnap.role).toBe('viewer');

    const editorSnap = (await editorConn.waitFor((m) => m.t === 'SNAPSHOT')) as Extract<S2C, { t: 'SNAPSHOT' }>;
    expect(editorSnap.role).toBe('editor');

    const initialVersion = viewerSnap.v;

    // Viewer sends EDIT -> rejected with ERROR read_only + SNAPSHOT resend
    viewerConn.ws.send(
      JSON.stringify({
        t: 'EDIT',
        opId: 1,
        edits: [{ cell: 'A1', raw: 'hacked' }],
      })
    );

    const err = await viewerConn.waitFor((m) => m.t === 'ERROR');
    expect(err).toMatchObject({ t: 'ERROR', code: 'read_only' });

    // Fresh snapshot arrives for viewer, version remains untouched
    const freshSnap = (await viewerConn.waitFor(
      (m: S2C) => m.t === 'SNAPSHOT' && viewerConn.messages.indexOf(m) > 0
    )) as Extract<S2C, { t: 'SNAPSHOT' }>;
    expect(freshSnap.v).toBe(initialVersion);

    // Editor sends EDIT -> works and reaches viewer
    editorConn.ws.send(
      JSON.stringify({
        t: 'EDIT',
        opId: 1,
        edits: [{ cell: 'A1', raw: '100' }],
      })
    );

    const editorOp = await editorConn.waitFor((m) => m.t === 'OP');
    const viewerOp = await viewerConn.waitFor((m) => m.t === 'OP');
    expect(editorOp).toMatchObject({
      t: 'OP',
      op: { v: initialVersion + 1, edits: [{ cell: 'A1', raw: '100' }] },
    });
    expect(viewerOp).toEqual(editorOp);

    await s.close();
  });

  it('public sheet as guest (editor + viewer)', async () => {
    const s = startServer({
      port: 0,
      persist: false,
      auth: 'on',
      dataDir: tempDir,
    });

    const sheet = s.sheetManager!.createSheet('owner@example.com');

    // 1. Public editor
    s.sheetManager!.updateShare(sheet.id, 'public', 'editor', []);
    const guestEditorConn = connectWs(s.port);
    await new Promise((r) => guestEditorConn.ws.on('open', r));
    guestEditorConn.ws.send(JSON.stringify({ t: 'JOIN', sheetId: sheet.id, name: '', cid: 'g1' }));

    const snapEditor = (await guestEditorConn.waitFor((m) => m.t === 'SNAPSHOT')) as any;
    expect(snapEditor.role).toBe('editor');
    expect(snapEditor.you.name).toMatch(/^Guest \d+$/);

    guestEditorConn.ws.send(
      JSON.stringify({ t: 'EDIT', opId: 1, edits: [{ cell: 'B1', raw: 'guest-edit' }] })
    );
    const op = await guestEditorConn.waitFor((m) => m.t === 'OP');
    expect(op.t).toBe('OP');

    // 2. Public viewer
    s.sheetManager!.updateShare(sheet.id, 'public', 'viewer', []);
    const guestViewerConn = connectWs(s.port);
    await new Promise((r) => guestViewerConn.ws.on('open', r));
    guestViewerConn.ws.send(JSON.stringify({ t: 'JOIN', sheetId: sheet.id, name: '', cid: 'g2' }));

    const snapViewer = (await guestViewerConn.waitFor((m) => m.t === 'SNAPSHOT')) as any;
    expect(snapViewer.role).toBe('viewer');

    guestViewerConn.ws.send(
      JSON.stringify({ t: 'EDIT', opId: 1, edits: [{ cell: 'B2', raw: 'guest-fail' }] })
    );
    const err = await guestViewerConn.waitFor((m) => m.t === 'ERROR');
    expect(err).toMatchObject({ t: 'ERROR', code: 'read_only' });

    await s.close();
  });

  it('revoking access closes a live socket', async () => {
    const s = startServer({
      port: 0,
      persist: false,
      auth: 'on',
      dataDir: tempDir,
    });

    const sheet = s.sheetManager!.createSheet('owner@example.com');
    s.sheetManager!.updateShare(sheet.id, 'restricted', 'viewer', [
      ['user@example.com', 'editor'],
    ]);

    const sid = s.sessionManager!.createSession({
      email: 'user@example.com',
      name: 'User',
    });
    const conn = connectWs(s.port, `sid=${sid}`);
    await new Promise((r) => conn.ws.on('open', r));
    conn.ws.send(JSON.stringify({ t: 'JOIN', sheetId: sheet.id, name: '', cid: 'rev1' }));

    await conn.waitFor((m) => m.t === 'SNAPSHOT');

    // Revoke user from ACL
    s.sheetManager!.updateShare(sheet.id, 'restricted', 'viewer', []);

    const err = await conn.waitFor((m) => m.t === 'ERROR');
    expect(err).toMatchObject({ t: 'ERROR', code: 'forbidden' });

    const closeInfo = await conn.waitForClose();
    expect(closeInfo.code).toBe(4403);

    await s.close();
  });

  it('role change sends ROLE then old permissions no longer apply', async () => {
    const s = startServer({
      port: 0,
      persist: false,
      auth: 'on',
      dataDir: tempDir,
    });

    const sheet = s.sheetManager!.createSheet('owner@example.com');
    s.sheetManager!.updateShare(sheet.id, 'restricted', 'viewer', [
      ['user@example.com', 'editor'],
    ]);

    const sid = s.sessionManager!.createSession({
      email: 'user@example.com',
      name: 'User',
    });
    const conn = connectWs(s.port, `sid=${sid}`);
    await new Promise((r) => conn.ws.on('open', r));
    conn.ws.send(JSON.stringify({ t: 'JOIN', sheetId: sheet.id, name: '', cid: 'rc1' }));

    const snap = (await conn.waitFor((m) => m.t === 'SNAPSHOT')) as any;
    expect(snap.role).toBe('editor');

    // Downgrade to viewer
    s.sheetManager!.updateShare(sheet.id, 'restricted', 'viewer', [
      ['user@example.com', 'viewer'],
    ]);

    const roleMsg = (await conn.waitFor((m) => m.t === 'ROLE')) as any;
    expect(roleMsg).toMatchObject({ t: 'ROLE', role: 'viewer' });

    // Now edit is rejected
    conn.ws.send(
      JSON.stringify({ t: 'EDIT', opId: 1, edits: [{ cell: 'C1', raw: 'nope' }] })
    );
    const err = await conn.waitFor((m) => m.t === 'ERROR');
    expect(err).toMatchObject({ t: 'ERROR', code: 'read_only' });

    await s.close();
  });

  it('two sheets stay isolated', async () => {
    const s = startServer({
      port: 0,
      persist: false,
      auth: 'on',
      dataDir: tempDir,
    });

    const sheet1 = s.sheetManager!.createSheet('user1@example.com');
    const sheet2 = s.sheetManager!.createSheet('user2@example.com');
    s.sheetManager!.updateShare(sheet1.id, 'public', 'editor', []);
    s.sheetManager!.updateShare(sheet2.id, 'public', 'editor', []);

    const conn1 = connectWs(s.port);
    const conn2 = connectWs(s.port);
    await Promise.all([
      new Promise((r) => conn1.ws.on('open', r)),
      new Promise((r) => conn2.ws.on('open', r)),
    ]);

    conn1.ws.send(JSON.stringify({ t: 'JOIN', sheetId: sheet1.id, name: '', cid: 's1' }));
    conn2.ws.send(JSON.stringify({ t: 'JOIN', sheetId: sheet2.id, name: '', cid: 's2' }));

    await Promise.all([
      conn1.waitFor((m) => m.t === 'SNAPSHOT'),
      conn2.waitFor((m) => m.t === 'SNAPSHOT'),
    ]);

    // Client 1 edits sheet 1
    conn1.ws.send(
      JSON.stringify({ t: 'EDIT', opId: 1, edits: [{ cell: 'A1', raw: 'isolated-sheet-1' }] })
    );
    await conn1.waitFor((m) => m.t === 'OP');

    // Wait a brief tick and verify Client 2 has received no OP messages
    await new Promise((r) => setTimeout(r, 100));
    expect(conn2.messages.some((m) => m.t === 'OP')).toBe(false);

    // Verify room 2 has no A1 cell
    const room2 = s.sheetManager!.getOrCreateRoom(sheet2.id)!;
    expect(room2.getRaw().has('A1')).toBe(false);

    await s.close();
  });
});
