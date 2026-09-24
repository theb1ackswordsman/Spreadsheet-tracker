# STATUS (update after every step; max 15 lines)
Done: P0, P1a, P1b, P1c, P2a, P2b, P2c
Next: P3
Known issues: (none)
Bench: fan-out 10k: ~10.6 ms, chain 1k: ~1.7 ms (median of 10, incremental)
P2a: worker.ts, bridge.ts, store.ts (raw mirror Map, immutable Result, rAF batch, useCell).
P2b: Grid.tsx (virtualized rows, sticky headers), Cell.tsx, nav.ts (navigate|edit state machine).
P2c: Editor.tsx (autofocus, seeded with raw, local buffer protected, Enter/Tab commit+move, Esc cancels, blur commits), FormulaBar.tsx (name box, fx, mono input bound to raw, danger error line), commit.ts (commitEdits single path to store.raw + bridge.apply). Grid refocus on commit/cancel, Delete clears cell. 91 tests pass.
