import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

export interface SessionUser {
  email: string;
  name: string;
}

export interface SessionData {
  email: string;
  name: string;
  exp: number; // timestamp in ms
}

export type VerifyGoogleCodeFn = (
  code: string,
  redirectUri?: string
) => Promise<{ email: string; name: string; email_verified?: boolean } | null>;

// ── Rate limiter ──

interface RateRecord {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly records = new Map<string, RateRecord>();
  private readonly windowMs: number;
  private readonly max: number;

  constructor(max = 10, windowMs = 60 * 1000) {
    this.max = max;
    this.windowMs = windowMs;
  }

  isAllowed(key: string): boolean {
    const now = Date.now();
    const rec = this.records.get(key);
    if (!rec || now >= rec.resetAt) {
      this.records.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (rec.count >= this.max) {
      return false;
    }
    rec.count++;
    return true;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, rec] of this.records) {
      if (now >= rec.resetAt) {
        this.records.delete(key);
      }
    }
  }
}

// ── Session Manager ──

export class SessionManager {
  private readonly sessions = new Map<string, SessionData>(); // sha256(sid) -> SessionData
  private readonly filePath: string;
  private readonly persist: boolean;
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(dataDir: string, persist = true) {
    this.filePath = path.join(dataDir, 'sessions.json');
    this.persist = persist;
    if (persist) {
      this.load();
      this.timer = setInterval(() => {
        if (this.dirty) this.save();
      }, 5000);
      this.timer.unref?.();
    }
  }

  static hashSid(sid: string): string {
    return crypto.createHash('sha256').update(sid).digest('hex');
  }

  createSession(user: SessionUser): string {
    const sid = crypto.randomBytes(32).toString('base64url');
    const hash = SessionManager.hashSid(sid);
    const exp = Date.now() + 604800 * 1000; // 7 days (604800s)
    this.sessions.set(hash, {
      email: user.email.toLowerCase().trim(),
      name: user.name.trim() || 'Guest',
      exp,
    });
    this.dirty = true;
    if (this.persist) {
      this.save();
    }
    return sid;
  }

  getSession(sid: string): SessionUser | null {
    if (!sid) return null;
    const hash = SessionManager.hashSid(sid);
    const data = this.sessions.get(hash);
    if (!data) return null;
    if (Date.now() >= data.exp) {
      this.sessions.delete(hash);
      this.dirty = true;
      return null;
    }
    return { email: data.email, name: data.name };
  }

  deleteSession(sid: string): void {
    if (!sid) return;
    const hash = SessionManager.hashSid(sid);
    if (this.sessions.delete(hash)) {
      this.dirty = true;
      if (this.persist) {
        this.save();
      }
    }
  }

  load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Record<string, SessionData>;
      const now = Date.now();
      for (const [hash, session] of Object.entries(data)) {
        if (session.exp > now) {
          this.sessions.set(hash, session);
        }
      }
    } catch {
      // Ignore corrupted or missing sessions file
    }
  }

  save(): void {
    if (!this.persist) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const obj: Record<string, SessionData> = {};
      const now = Date.now();
      for (const [hash, session] of this.sessions) {
        if (session.exp > now) {
          obj[hash] = session;
        }
      }
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
      fs.renameSync(tmp, this.filePath);
      this.dirty = false;
    } catch {
      // Ignore save failure
    }
  }

  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.dirty && this.persist) {
      this.save();
    }
  }
}

// ── Cookie Helpers ──

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  const pairs = header.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx !== -1) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (key && !(key in cookies)) {
        cookies[key] = decodeURIComponent(val);
      }
    }
  }
  return cookies;
}

export function getSessionFromRequest(
  req: http.IncomingMessage,
  sessionManager: SessionManager
): SessionUser | null {
  const cookies = parseCookies(req.headers['cookie']);
  const sid = cookies['sid'];
  if (!sid) return null;
  return sessionManager.getSession(sid);
}

export function buildSetCookie(
  sid: string,
  req: http.IncomingMessage,
  maxAgeSec = 604800
): string {
  const isSecure =
    process.env['NODE_ENV'] === 'production' ||
    req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `sid=${encodeURIComponent(sid)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSec}`,
  ];
  if (isSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function buildClearCookie(req: http.IncomingMessage): string {
  return buildSetCookie('', req, 0);
}

// ── CSRF and Origin checks ──

export function checkCsrfAndOrigin(req: http.IncomingMessage): {
  ok: true;
} | {
  ok: false;
  status: number;
  error: string;
} {
  // Check X-Requested-With
  const xrw = req.headers['x-requested-with'];
  if (!xrw) {
    return { ok: false, status: 400, error: 'bad_request' };
  }

  // Check Origin
  const origin = req.headers['origin'];
  if (!origin) {
    return { ok: false, status: 403, error: 'forbidden' };
  }

  let originHost: string;
  try {
    originHost = new URL(origin).hostname;
  } catch {
    return { ok: false, status: 403, error: 'forbidden' };
  }

  // Localhost / 127.0.0.1 allowed
  if (originHost === 'localhost' || originHost === '127.0.0.1') {
    return { ok: true };
  }

  // Same host check
  const host = req.headers['host'] ?? '';
  const hostWithoutPort = host.split(':')[0] ?? '';
  if (originHost === hostWithoutPort) {
    return { ok: true };
  }

  // ALLOWED_ORIGINS env
  const allowed = process.env['ALLOWED_ORIGINS'];
  if (allowed) {
    const list = allowed.split(',').map((s) => s.trim());
    if (list.includes(originHost)) {
      return { ok: true };
    }
  }

  return { ok: false, status: 403, error: 'forbidden' };
}

// ── Loopback check for Dev Login ──

export function isLoopback(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  );
}

// ── JSON Body reader ──

export function readJsonBody(
  req: http.IncomingMessage,
  maxBytes = 32 * 1024
): Promise<{ ok: true; body: any } | { ok: false; status: number; error: string }> {
  return new Promise((resolve) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    let tooBig = false;

    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        tooBig = true;
        req.destroy();
        resolve({ ok: false, status: 413, error: 'bad_request' });
      } else {
        chunks.push(chunk);
      }
    });

    req.on('end', () => {
      if (tooBig) return;
      const str = Buffer.concat(chunks).toString('utf8');
      if (!str.trim()) {
        resolve({ ok: true, body: {} });
        return;
      }
      try {
        const body = JSON.parse(str);
        resolve({ ok: true, body });
      } catch {
        resolve({ ok: false, status: 400, error: 'bad_request' });
      }
    });

    req.on('error', () => {
      resolve({ ok: false, status: 400, error: 'bad_request' });
    });
  });
}

// ── Default Google Code Verification ──

export async function defaultVerifyGoogleCode(
  code: string,
  redirectUri?: string
): Promise<{ email: string; name: string; email_verified?: boolean } | null> {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET required');
  }

  const client = new OAuth2Client(clientId, clientSecret, redirectUri || 'postmessage');
  let idToken: string | undefined;

  try {
    const { tokens } = await client.getToken({
      code,
      redirect_uri: redirectUri || 'postmessage',
    });
    idToken = tokens.id_token ?? undefined;
  } catch (err: unknown) {
    if (redirectUri && redirectUri !== 'postmessage') {
      const { tokens } = await client.getToken({
        code,
        redirect_uri: redirectUri,
      });
      idToken = tokens.id_token ?? undefined;
    } else {
      throw err;
    }
  }

  if (!idToken) return null;

  const ticket = await client.verifyIdToken({
    idToken,
    audience: clientId,
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.email) return null;

  return {
    email: payload.email,
    name: payload.name || payload.email.split('@')[0] || 'Guest',
    email_verified: payload.email_verified === true,
  };
}
