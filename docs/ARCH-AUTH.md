# ARCH-AUTH (supersedes ARCH where different; read only the cited section)

## Model
```ts
type Role = 'owner' | 'editor' | 'viewer';
type SheetMeta = {
  id: string; title: string; owner: string;            // owner = lowercase verified email
  visibility: 'restricted' | 'public'; publicRole: 'viewer' | 'editor';
  acl: [string, 'editor' | 'viewer'][];                 // lowercase email -> role (Map in memory)
  createdAt: number; updatedAt: number;
};
type SessionUser = { email: string; name: string };
```
`roleFor(meta, user | null)`: owner if email == owner; else highest of (acl role for email) and (publicRole if visibility == 'public'); else null. Guests (user null) can only get the public role.
Sheet ids: `crypto.randomBytes(16).toString('base64url')` (unguessable; the link is the capability for public sheets).

## Auth flow (Google OAuth authorization-code, popup)
1. Client: `google.accounts.oauth2.initCodeClient({ client_id, scope: 'openid email profile', ux_mode: 'popup', callback })`; the custom "Start working" button calls `requestCode()` inside its click handler (user gesture required). Client id comes from GET /api/config.
2. Callback POSTs `{ code }` to `/api/auth/google` with header `X-Requested-With: fetch`.
3. Server exchanges the code with `google-auth-library` (OAuth2Client with client id + secret), then `verifyIdToken({ idToken, audience: CLIENT_ID })`. Require `email_verified === true`. Email lowercased. Trap: the `redirect_uri` for the exchange in popup mode: try `'postmessage'`; if Google returns redirect_uri_mismatch, use the page origin. Follow current Google docs, do not guess further.
4. Create session: 32 random bytes (base64url) as `sid`; store `sha256(sid) -> { email, name, exp }` in memory, persisted to `data/sessions.json` (atomic). Cookie: `sid; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`; add `Secure` when NODE_ENV=production or `x-forwarded-proto` is https.
5. Verification is injected (`startServer({ verifyGoogleCode })`) so tests never call Google.

## HTTP API (JSON, same origin; Vite proxies /api to :8787)
- `GET /api/config` -> `{ googleClientId, devLogin }`
- `GET /api/me` -> `{ user: SessionUser | null }`
- `POST /api/auth/google` `{code}` -> `{ user }` ; `POST /api/auth/logout`
- `POST /api/auth/dev` `{email,name}` only if env ALLOW_DEV_LOGIN=1 AND the socket's remote address is loopback (offline demo fallback; never set on a deployed host)
- `POST /api/sheets` (auth) -> `{ id }` (title "Untitled sheet", restricted) ; `GET /api/sheets` (auth) -> recent owned + shared, max 20, each `{id,title,role,updatedAt}`
- `GET /api/sheets/:id` -> `{ id, title, role, visibility, publicRole, acl? }` (acl only for owner); not signed in and restricted -> 401 `signin_required`; no access -> 403 `forbidden`
- `PATCH /api/sheets/:id` `{title}` (owner/editor) ; `PUT /api/sheets/:id/share` (owner) `{visibility, publicRole, acl}`
Rules: every non-GET checks Origin (same host, or localhost) and `X-Requested-With`; JSON body <= 32 KB; errors are `{ error: code }`.

## Protocol changes (authorized in P9a only)
Add `export type Role = 'owner' | 'editor' | 'viewer';` to protocol.ts. `SNAPSHOT` gains `role: Role`. New S2C `{ t: 'ROLE'; role: Role }`. `ERROR` becomes `{ t: 'ERROR'; code: 'forbidden' | 'signin_required' | 'read_only' | 'bad_request'; msg: string }`. JOIN/RESUME keep `sheetId`; `name` is ignored (identity is server-side). Update docs/ARCH.md "Protocol" to match.

## WebSocket
- On upgrade: parse the `sid` cookie -> user or null; keep the existing Origin check.
- JOIN/RESUME: load room by sheetId (must exist, else ERROR forbidden + close 4403); `role = roleFor`. null -> ERROR (`signin_required` if no user, else `forbidden`) then close 4403. Store role on the connection.
- Display name = Google name (<= 24 chars); guests are "Guest N" (server counter). `u` and color stay server-assigned.
- EDIT with role viewer: reject with ERROR `read_only`, do NOT apply or bump version, then send a fresh SNAPSHOT so the client's optimistic state reconverges. SELECT is allowed for viewers.
- When share settings change (PUT share): recompute every connected client's role: null -> ERROR forbidden + close 4403; changed -> send ROLE.

## Storage
`data/sheets/<id>.json` = `{ meta, v, cells }`, atomic writes (temp + rename), every 5 s if dirty and on shutdown. Rooms load lazily and are evicted 10 min after the last client leaves (flush first). On boot, scan meta files into `Map<email, Set<id>>` for GET /api/sheets. The old single `data/sheet.json` is retired. `startServer({ auth: 'off' })` keeps one in-memory room where everyone is editor (tests and sim only).

## Security checklist
Token audience + issuer verified; `email_verified` required; secrets never logged or sent to the client; unguessable ids; 401/403 responses identical for "not shared" vs "does not exist" is NOT required, but ids must not be enumerable; rate limits: /api/auth 10/min/IP, POST /api/sheets 20/hour/user; acl <= 100 entries, email regex and <= 254 chars, lowercased; title <= 100 chars, control chars stripped; role re-checked on every EDIT, not only at JOIN; logout deletes the session; no email is ever sent (the owner copies the link).

## Client
- No router library. History API: `/` landing or redirect, `/s/:id` sheet, anything else a plain 404 panel. Boot: GET /api/me, GET /api/config.
- `/` signed in -> GET /api/sheets -> replace to the most recent, or POST /api/sheets then replace to the new one. Signed out -> landing.
- `/s/:id` signed out + `signin_required` -> AuthPanel ("Sign in to open this sheet", Google button, path preserved, returns to it after sign-in). `forbidden` -> "You don't have access" panel with the signed-in email, "Switch account" (logout then sign in).
- Route change or sign-out: close the socket, reset store/bridge state for the new sheet (`resetForSheet(id)`), reconnect. Never let sheet A's cells appear in sheet B.
- Viewer role: no editor mounts, Delete/paste ignored, formula bar read-only, banner "View only".
