# STATUS (update after every step; max 15 lines)
Done: P0, P1a, P1b, P1c, P2a
Next: P2b
Known issues: (none)
Bench: fan-out 10k: ~10.6 ms, chain 1k: ~1.7 ms (median of 10, incremental)
P2a: worker.ts (Engine owner, INIT/APPLY→PATCH, try/catch, microtask coalesce), bridge.ts (singleton, posts to worker, forwards PATCH to store), store.ts (raw mirror Map, immutable Result per cell, per-cell subs, meta, rAF batch, useCell hook via useSyncExternalStore). 6 store tests pass. Worker bundles as separate chunk.
