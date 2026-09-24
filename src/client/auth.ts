// ── Client-side auth: config fetching, GIS script loading, sign-in, sign-out ──

export interface AuthConfig {
  googleClientId: string;
  devLogin: boolean;
}

export interface AuthUser {
  email: string;
  name: string;
}

// Fetch /api/config
export async function fetchConfig(): Promise<AuthConfig> {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error('config fetch failed');
  return res.json() as Promise<AuthConfig>;
}

// Fetch /api/me
export async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch('/api/me');
  if (!res.ok) return null;
  const data = await res.json() as { user: AuthUser | null };
  return data.user;
}

// POST /api/auth/google with code
async function postGoogleCode(code: string): Promise<AuthUser> {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? 'auth_failed');
  }
  const data = await res.json() as { user: AuthUser };
  return data.user;
}

// POST /api/auth/dev
export async function devSignIn(email: string, name: string): Promise<AuthUser> {
  const res = await fetch('/api/auth/dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: JSON.stringify({ email, name }),
  });
  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? 'dev_login_failed');
  }
  const data = await res.json() as { user: AuthUser };
  return data.user;
}

// POST /api/auth/logout
export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'X-Requested-With': 'fetch' },
  });
}

// POST /api/sheets (create new)
export async function createSheet(): Promise<string> {
  const res = await fetch('/api/sheets', {
    method: 'POST',
    headers: { 'X-Requested-With': 'fetch' },
  });
  if (!res.ok) throw new Error('create_sheet_failed');
  const data = await res.json() as { id: string };
  return data.id;
}

// GET /api/sheets (recent)
export interface SheetEntry {
  id: string;
  title: string;
  role: string;
  updatedAt: number;
}

export async function fetchSheets(): Promise<SheetEntry[]> {
  const res = await fetch('/api/sheets');
  if (!res.ok) return [];
  return res.json() as Promise<SheetEntry[]>;
}

// GET /api/sheets/:id
export interface SheetInfo {
  id: string;
  title: string;
  role: string;
  visibility: string;
  publicRole: string;
}

export async function fetchSheetInfo(sheetId: string): Promise<{ info?: SheetInfo; error?: string }> {
  const res = await fetch(`/api/sheets/${encodeURIComponent(sheetId)}`);
  if (res.ok) {
    const info = await res.json() as SheetInfo;
    return { info };
  }
  const body = await res.json() as { error?: string };
  return { error: body.error ?? 'unknown' };
}

// ── Google Identity Services code client ──

// Type declaration for google.accounts.oauth2
interface GisCodeClient {
  requestCode(): void;
}

interface GisOAuth2 {
  initCodeClient(config: {
    client_id: string;
    scope: string;
    ux_mode: 'popup';
    callback: (response: { code?: string; error?: string }) => void;
  }): GisCodeClient;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GisOAuth2;
      };
    };
  }
}

let gisScriptLoaded = false;
let gisScriptLoading = false;
const gisLoadCallbacks: Array<() => void> = [];

export function loadGisScript(): Promise<void> {
  if (gisScriptLoaded) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    gisLoadCallbacks.push(resolve);
    if (gisScriptLoading) return;
    gisScriptLoading = true;
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      gisScriptLoaded = true;
      for (const cb of gisLoadCallbacks) cb();
      gisLoadCallbacks.length = 0;
    };
    script.onerror = () => {
      gisScriptLoading = false;
      reject(new Error('gis_script_failed'));
    };
    document.head.appendChild(script);
  });
}

if (typeof window !== 'undefined') {
  loadGisScript().catch(() => {});
}

let codeClient: GisCodeClient | null = null;
let activeResolve: ((result: SignInResult) => void) | null = null;

function handleOauthCallback(response: { code?: string; error?: string }): void {
  const resolve = activeResolve;
  activeResolve = null;
  if (!resolve) return;

  if (response.error) {
    resolve({ ok: false, error: mapGisError(response.error) });
    return;
  }
  if (!response.code) {
    resolve({ ok: false, error: 'No authorization code received' });
    return;
  }
  postGoogleCode(response.code)
    .then((user) => resolve({ ok: true, user }))
    .catch((e) => resolve({ ok: false, error: e instanceof Error ? e.message : 'Sign-in failed' }));
}

export type SignInResult =
  | { ok: true; user: AuthUser }
  | { ok: false; error: string };

/**
 * Initiate Google sign-in via code client popup.
 * Must be called inside a user gesture handler.
 * Returns the signed-in user or an error.
 */
export function googleSignIn(clientId: string): Promise<SignInResult> {
  if (!clientId) {
    return Promise.resolve({ ok: false, error: 'Google sign-in is not configured' });
  }

  return new Promise((resolve) => {
    activeResolve = resolve;
    loadGisScript().then(() => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (!oauth2) {
        activeResolve = null;
        resolve({ ok: false, error: 'Google sign-in not available' });
        return;
      }

      if (!codeClient) {
        codeClient = oauth2.initCodeClient({
          client_id: clientId,
          scope: 'openid email profile',
          ux_mode: 'popup',
          callback: handleOauthCallback,
        });
      }

      codeClient.requestCode();
    }).catch(() => {
      activeResolve = null;
      resolve({ ok: false, error: 'Could not load Google sign-in' });
    });
  });
}

export function mapGisError(error: string): string {
  if (error === 'popup_closed' || error === 'popup_closed_by_user') {
    return 'Sign-in popup was closed';
  }
  if (error === 'popup_blocked' || error === 'popup_blocked_by_browser') {
    return 'Sign-in popup was blocked. Allow popups and try again.';
  }
  if (error === 'access_denied') {
    return 'Access was denied';
  }
  return `Sign-in error: ${error}`;
}
