# STATUS (update after every step; max 15 lines)
Done: P0, P1a, P1b, P1c, P2a, P2b, P2c, P3, P4, P5, P6, P7
Next: None (FEATURE FREEZE)
Known issues: (none)
Bench: fan-out 10k: ~10.6 ms, chain 1k: ~1.7 ms (median of 10, incremental)
P5: UI polish per DESIGN. Top bar, toolbar, FormulaBar explanation, StatusBar, HintBar, Shortcuts, TSV paste. 105 tests pass.
P6: Hardening + bot sim. Token bucket, maxPayload, origin check, name sanitize, atomic persistence, /debug/hash. 113 tests pass.
P7: Performance strip, RTT via echo EMA, production render counter, stress test (11k formulas). 119 tests pass.
Stress numbers: Incremental A1: scope 11001, ~13.8 ms; Naive A1: scope 11001, ~12.4 ms; render count 331 (virtualized viewport).
