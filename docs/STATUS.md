# STATUS (update after every step; max 15 lines)
Done: P0, P1a, P1b, P1c, P2a, P2b, P2c, P3
Next: P4
Known issues: (none)
Bench: fan-out 10k: ~10.6 ms, chain 1k: ~1.7 ms (median of 10, incremental)
P2a: worker.ts, bridge.ts, store.ts (raw mirror Map, immutable Result, rAF batch, useCell).
P2b: Grid.tsx (virtualized rows, sticky headers), Cell.tsx, nav.ts (navigate|edit state machine).
P2c: Editor.tsx (autofocus, seeded with raw, local buffer protected, Enter/Tab commit+move, Esc cancels, blur commits), FormulaBar.tsx (name box, fx, mono input bound to raw, danger error line), commit.ts (commitEdits single path to store.raw + bridge.apply). Grid refocus on commit/cancel, Delete clears cell. 91 tests pass.
P3: room.ts (Room class: JOIN->SNAPSHOT, EDIT with opId dedupe + validation + v++ + op ring + broadcast OP to all, RESUME->OPS or SNAPSHOT). index.ts (http+wss, first-msg routing). socket.ts (singleton, auto-reconnect 250ms..5s, SNAPSHOT->replaceRawMirror+bridgeInit, OP/OPS->bridgeApply idempotent). commit.ts extended with sendEdit. 9 server validation + 1 integration test (two ws clients, same-cell edits, identical OP sequences). 101 tests pass.
