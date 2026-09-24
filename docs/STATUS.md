# STATUS (update after every step; max 15 lines)
Done: P0, P1a, P1b, P1c, P2a, P2b, P2c, P3, P4, P5
Next: P6
Known issues: (none)
Bench: fan-out 10k: ~10.6 ms, chain 1k: ~1.7 ms (median of 10, incremental)
P2c: Editor.tsx, FormulaBar.tsx, commit.ts. Grid refocus, Delete clears cell. 91 tests pass.
P3: room.ts, index.ts, socket.ts, commit.ts with sendEdit. 101 tests pass.
P4: Session table, presence broadcast throttle, reconnect replay, avatars, overwrite toast. 105 tests pass.
P5: UI polish per DESIGN. Top bar (editable title, connection text, avatars, share link), toolbar (Sample data, Shortcuts), FormulaBar error explanation, StatusBar (users, version, recalc stats), HintBar, Shortcuts popover, sample.ts (budget + 3-step chain + silent commit), DOM copy/paste TSV, a11y roles/indices/focus ring. 105 tests pass.
