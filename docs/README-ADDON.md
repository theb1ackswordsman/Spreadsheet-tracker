# Auth + Sharing add-on (for the human; the AI never reads this)

## Install
Unzip over your repo root (adds docs/ARCH-AUTH.md and docs/phases/P9a-P9d.md). Then append the block below to CLAUDE.md and add "Next: P7, then P9a" to docs/STATUS.md.

```
## Auth rules (added)
- Allowed deps now also include: google-auth-library. Nothing else.
- Identity comes ONLY from the verified server session cookie, never from client payloads.
- `auth: 'off'` exists only as a startServer() option for tests and the sim. Never read it from env or a query param.
- GOOGLE_CLIENT_SECRET lives only in server env (.env, gitignored). Never in client code, logs, or commits.
- protocol.ts may change ONLY as specified in docs/ARCH-AUTH.md "Protocol changes" during P9a.
```

## Order
P7 (finish, it is a must-keep) -> P9a -> P9b -> P9c -> P8 (QA + prod run). Do H0 (Google Cloud setup, docs/phases/P9d.md part 1) in parallel while the agent works on P9a. Time is tight: P9c ships link-sharing only (Part 2, the people list, is dropped — re-add later as its own step if there's time left).

## Sessions
Same rules as before: one fresh session per step, `Do P9a.` etc. Strongest model for P9a; mid-tier is fine for P9b and P9c.
