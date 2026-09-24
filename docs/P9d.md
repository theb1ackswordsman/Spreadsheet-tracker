# P9d Google Cloud setup + sharing over the internet (human-led, ~30 min; agent only for the prod-serve change in P8)
## H0 Google Cloud (do while P9a runs)
1. console.cloud.google.com: new project. OAuth consent screen: type External, app name, support email; scopes: openid, email, profile only.
2. While "Testing", only listed test users can sign in — add teammate/judge Gmails as test users, or set to "In production" (basic scopes shouldn't need verification, but check for warnings).
3. Credentials > OAuth client ID > Web application. Authorized JS origins: http://localhost, http://localhost:5173, http://localhost:8787, plus your public HTTPS origin once you have it. Copy client ID + secret.
4. Repo `.env` (gitignored): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. Start server with them in env (`tsx --env-file=.env src/server/index.ts`). Server refuses to start in production without both.
## H1 Share with other people
localhost isn't reachable by others. Fastest: run the prod build (P8 step 1), expose port 8787 via an HTTPS tunnel (cloudflared/ngrok), add that origin to Authorized JS origins, open via the tunnel URL. Permanent option: any host running a long-lived Node process with WebSocket + HTTPS (not serverless). Set NODE_ENV=production for Secure cookies.
## H2 Demo-day fallback
Google sign-in needs internet — keep `ALLOW_DEV_LOGIN=1` (loopback only) as an offline fallback. Never set it on the tunnel/deployed process.
## H3 Auth QA (add to P8)
Signed-out deep link -> sign-in -> returns to sheet. Stranger on restricted link sees "No access". Public link works signed out. Viewer can't edit even via devtools. Revoke closes live sockets. Sign out on one tab doesn't break the other's socket until reconnect (fine). `grep -r GOOGLE_CLIENT_SECRET dist` finds nothing.
