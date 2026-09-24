# Collaborative Spreadsheet (hackathon, 10h build)
Real-time multiplayer spreadsheet. Stack LOCKED: React 18 + Vite + TypeScript strict, Node `ws`, Web Workers, custom DAG formula engine.

## Session protocol (follow exactly)
1. Read `docs/STATUS.md`, then ONLY the phase file the user names (`docs/phases/PX.md`). Read sections of `docs/ARCH.md` / `docs/DESIGN.md` only when the phase file cites them (by heading).
2. Do only the named step (e.g. "P1a"). No repo exploring, no extra features, no refactors.
3. Verify with the commands below. If still red after 2 fix attempts, stop and report the first error.
4. Update `docs/STATUS.md` (max 15 lines), then `git add -A && git commit -m "<step>" && git tag <step>-green`.
5. Reply in <=5 lines: done / verify result / next step. Then stop.

## Commands
`npm test` (vitest, dot reporter) | `npm run typecheck` | `npm run dev` | `npm run sim`
Always trim output: `npm run typecheck 2>&1 | head -30`. Never print whole files or full logs.

## Hard rules
- Allowed deps only: react, react-dom, vite, @vitejs/plugin-react, typescript, ws, vitest, tsx, concurrently, @types/{react,react-dom,node,ws}. Ask before adding anything.
- No state, grid, formula, CRDT, UI-kit, icon, or CSS libraries.
- TS strict, no `any`, no `@ts-ignore`. Cell collections are `Map`, never plain objects.
- `src/engine` is pure TS: no DOM, no Node APIs, no deps, no Date/Math.random. Main thread imports engine TYPES only.
- Worker and WebSocket are module-level singletons; never created in components or effects (StrictMode double-mounts).
- All styling via CSS variables in `src/client/styles/tokens.css`. No color literals elsewhere.
- Never edit `src/shared/protocol.ts` or `src/engine/types.ts` without asking.
- No emojis, gradients, glows, or decorative shadows in UI or copy.
- Do not read README.md.

## Token discipline
- Don't re-read files you just wrote; use grep or line ranges on big files.
- Make targeted edits; don't rewrite whole files.
- Don't restate the task or explain code in replies.
