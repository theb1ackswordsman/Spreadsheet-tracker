# STATUS (update after every step; max 15 lines)
Done: P0, P1a, P1b, P1c, P2a, P2b, P2c, P3, P4, P5, P6, P7, P7b, P8a, P9a, P9b
Next: P9c
Known issues: (none)
Bench: fan-out 10k: ~10.6 ms, chain 1k: ~1.7 ms (median of 10, incremental)
P7: Performance strip, RTT via echo EMA, production render counter, stress test (11k formulas). 119 tests pass.
P7b: O1/P1/Q1 chain added (3-cell blast radius). Incremental O1: scope 3, sub-ms (~0.15ms); Naive O1: scope ~11003, ~10ms.
P8a: Prod serving via -static flag (Windows-safe). Path traversal protection, SPA fallback, MIME types. start:prod script. 125 tests pass.
P9a: Server auth + per-sheet storage + ACL. Role gate, sessions, REST routes, live share propagation, room eviction. 137 tests pass.
P9b: Landing + Google sign-in + History router + AccountMenu. Isolated sheets, resetForSheet, AuthPanel. 147 tests pass.

