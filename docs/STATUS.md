# STATUS (update after every step; max 15 lines)
Done: P0, P1a, P1b, P1c, P2a, P2b
Next: P2c
Known issues: (none)
Bench: fan-out 10k: ~10.6 ms, chain 1k: ~1.7 ms (median of 10, incremental)
P2a: worker.ts (Engine owner, INIT/APPLY→PATCH, try/catch, microtask coalesce), bridge.ts (singleton, posts to worker, forwards PATCH to store), store.ts (raw mirror Map, immutable Result per cell, per-cell subs, meta, rAF batch, useCell hook via useSyncExternalStore). 6 store tests pass. Worker bundles as separate chunk.
P2b: Grid.tsx (virtualized rows, spacer+translateY, overscan 4, rAF-throttled scroll, sticky col/row headers, active header highlight), Cell.tsx (React.memo, useCell, number/text/error display), nav.ts (navigate|edit state machine, 18 tests), wired into App.tsx. Dev render counter via store meta + window.__gridDevRenderCount. 82 tests pass.
