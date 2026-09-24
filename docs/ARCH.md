# ARCH (source of truth; read only the cited section)

## Types
Copy to `src/engine/types.ts`:
```ts
export type CellId = string; // "A1".."Z1000"
export type ErrCode = '#REF!' | '#DIV/0!' | '#VALUE!' | '#NAME?' | '#CIRCULAR!';
export type Value = number | string | null;
export type Result = { v: Value; e: ErrCode | null };
export type Edit = { cell: CellId; raw: string }; // raw '' = clear
export type Mode = 'inc' | 'naive';
export type PatchCell = [CellId, Value, ErrCode | null];
export type Stats = { scope: number; populated: number; ms: number; mode: Mode };
export type ToWorker = { t: 'INIT'; cells: [CellId, string][] } | { t: 'APPLY'; edits: Edit[]; mode: Mode };
export type FromWorker = { t: 'PATCH'; cells: PatchCell[]; stats: Stats };
```

## Protocol
Copy to `src/shared/protocol.ts`:
```ts
import type { CellId, Edit } from '../engine/types';
export type Role = 'owner' | 'editor' | 'viewer';
export type Op = { v: number; u: string; opId: number; edits: Edit[] };
export type User = { u: string; name: string; color: string; cell: CellId | null };
export type C2S =
  | { t: 'JOIN'; sheetId: string; name: string; cid: string }
  | { t: 'RESUME'; sheetId: string; name: string; lastVersion: number; cid: string }
  | { t: 'EDIT'; opId: number; edits: Edit[] }
  | { t: 'SELECT'; cell: CellId | null };
export type S2C =
  | { t: 'SNAPSHOT'; v: number; cells: [CellId, string][]; you: { u: string; name: string; color: string }; users: User[]; role: Role }
  | { t: 'OPS'; ops: Op[] }
  | { t: 'OP'; op: Op }
  | { t: 'PRESENCE'; users: User[] }
  | { t: 'ROLE'; role: Role }
  | { t: 'ERROR'; code: 'forbidden' | 'signin_required' | 'read_only' | 'bad_request'; msg: string };
```
`cid` is a random 128-bit id the client generates once per tab and keeps in memory. The server uses it as a dedupe key to reuse `u` and `lastOpId` across reconnects within 5 minutes. It is never an identity shown to others.

## Engine
Constants (`src/engine/constants.ts`): COLS=26, ROWS=1000, MAX_RANGE=10000, MAX_FORMULA=1000, MAX_DEPTH=64.
Syntax: `+ - * / ^`, unary `-`, parens, numbers, "strings", refs `A1`/`$A$1`, ranges `A1:B5`, functions SUM AVERAGE MIN MAX COUNT (case-insensitive). Parser: tokenizer + Pratt.
Semantics:
- Precedence high to low: unary -, ^, * /, + -. `^` LEFT-associative (2^3^2=64); -2^2=4.
- `$` ignored. Empty cell = 0 in arithmetic, skipped by aggregates. Text in arithmetic -> #VALUE!.
- COUNT counts numbers only. AVERAGE skips empty+text; none -> #DIV/0!. SUM/MIN/MAX of none -> 0.
- First error operand propagates. x/0 -> #DIV/0!. Unknown fn -> #NAME?. Parse error or bad arity -> #VALUE!.
- Ref outside grid or range > MAX_RANGE -> #REF!. Formula > MAX_FORMULA or depth > MAX_DEPTH -> #VALUE!.
- Non-formula raw: numeric string -> number, else string. '' = empty.
API:
```ts
parse(src: string): { ok: true; node: Node } | { ok: false }   // never throws
refsOf(node: Node): Set<CellId>                                 // expands ranges
evaluate(node: Node, get: (id: CellId) => Result): Result       // get returns {v:null,e:null} for empty
class Engine { setRaw(id, raw): void; loadAll(cells): void; recompute(changed: CellId[], mode: Mode): { patch: PatchCell[]; stats: Stats } }
```
Graph:
- `deps`: formula -> Set of cells it reads. `rdeps`: cell -> Set of formulas reading it, keyed EVEN IF THE CELL IS EMPTY. `setRaw` unlinks old edges, parses, links new.
- recompute: (1) scope = multi-source BFS over rdeps from `changed` (naive: all formula cells + changed). (2) Kahn over scope: indegree counts deps inside scope; queue uses a head index, never `shift()`. (3) Leftover "stuck" cells: cyclic = Tarjan SCCs of the stuck set with size>1 or a self-loop -> `#CIRCULAR!`; rest = stuck minus cyclic -> Kahn again -> evaluate (errors propagate naturally). (4) Evaluate in order; non-formula cells take value from raw. (5) patch = only cells whose Result changed. (6) stats.
- Same code runs in worker, tests, and sim. Deterministic.

## Consistency
Server assigns a total order (version `v`) to edit batches. Every client applies OPs in `v` order, including the echo of its own edits (idempotent: no-op if raw unchanged). Same raw map implies same values everywhere. Same-cell conflict: highest `v` wins; toast when a remote OP hits a cell you edited in the last 10 s.

## Server
- Rooms by sheetId (default "main"): version, raw `Map`, op log ring (5000), clients, presence. Built on `http.createServer` + `WebSocketServer({ server, path: '/ws' })`.
- Server assigns `u` (uuid), color (palette), sanitized name (<=24 chars). Never trust identity from payloads.
- EDIT: ignore if `opId <= client.lastOpId`. Validate each edit: cell matches `^[A-Z]{1,2}[0-9]{1,4}$` and is in bounds; raw is a string <=1000 chars; <=5000 edits per message. Then `v++`, apply (delete key if raw ''), push op, broadcast `OP` to everyone including sender.
- JOIN -> SNAPSHOT. RESUME: if `lastVersion >= oldestLoggedV - 1` send OPS after lastVersion, else SNAPSHOT.
- Presence: SELECT updates client.cell; broadcast PRESENCE throttled 50 ms; ping/pong every 15 s, terminate dead sockets; remove on close.
- Limits: maxPayload 256 KB, 30 msgs/s per socket (token bucket), origin check. Persist raw map to `data/sheet.json` every 5 s if dirty and on SIGINT; load at boot. Server never parses formulas.

## Client
- Singletons: `bridge` (worker), `socket`, `store`. Store: raw mirror Map, values `Map<CellId, Result>` (immutable objects replaced only on change), per-cell subscriptions, meta (stats, version, users, connection, toasts). `useCell(id)` via `useSyncExternalStore` returns the stable Result object. Apply each PATCH once per animation frame.
- Grid: 26 cols x 1000 rows; row 28 px, col 104 px; render visible rows + overscan 4; columns fully rendered. Mode state machine `navigate | edit`.
- Local edit: apply to worker immediately (optimistic), send EDIT with next `opId`, keep in `pending` until own OP echo. On reconnect: RESUME, then resend pending.
- Display: number -> `Number(v.toPrecision(12))`, right-aligned; string left; error centered.
