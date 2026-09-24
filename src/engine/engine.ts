import type { CellId, Result, Mode, PatchCell, Stats } from './types';
import type { ASTNode } from './parser';
import { parse, refsOf } from './parser';
import { evaluate } from './evaluator';

const EMPTY: Result = { v: null, e: null };

function parseRaw(raw: string): Result {
  if (raw === '') return EMPTY;
  const n = Number(raw);
  if (raw.trim() !== '' && !isNaN(n)) return { v: n, e: null };
  return { v: raw, e: null };
}

export class Engine {
  /** raw text per cell */
  private raws: Map<CellId, string> = new Map();
  /** parsed AST per formula cell */
  private asts: Map<CellId, ASTNode> = new Map();
  /** formula cell -> set of cells it reads */
  private deps: Map<CellId, Set<CellId>> = new Map();
  /** cell -> set of formula cells reading it */
  private rdeps: Map<CellId, Set<CellId>> = new Map();
  /** current computed results */
  private results: Map<CellId, Result> = new Map();

  // ── link / unlink ──

  private unlink(id: CellId): void {
    const old = this.deps.get(id);
    if (old) {
      for (const dep of old) {
        const s = this.rdeps.get(dep);
        if (s) {
          s.delete(id);
          if (s.size === 0) this.rdeps.delete(dep);
        }
      }
      this.deps.delete(id);
    }
    this.asts.delete(id);
  }

  private link(id: CellId, node: ASTNode, refs: Set<CellId>): void {
    this.asts.set(id, node);
    this.deps.set(id, refs);
    for (const dep of refs) {
      let s = this.rdeps.get(dep);
      if (!s) {
        s = new Set();
        this.rdeps.set(dep, s);
      }
      s.add(id);
    }
  }

  // ── public API ──

  setRaw(id: CellId, raw: string): void {
    const prev = this.raws.get(id);
    if (prev === raw) return;
    if (prev !== undefined) this.unlink(id);

    if (raw === '') {
      this.raws.delete(id);
      // unlink already done above
    } else {
      this.raws.set(id, raw);
      if (raw.startsWith('=')) {
        const pr = parse(raw.slice(1));
        if (pr.ok) {
          const refs = refsOf(pr.node);
          this.link(id, pr.node, refs);
        }
      }
    }
  }

  loadAll(cells: [CellId, string][]): void {
    for (const [id, raw] of cells) {
      this.setRaw(id, raw);
    }
  }

  getResult(id: CellId): Result {
    return this.results.get(id) ?? EMPTY;
  }

  getRaw(id: CellId): string {
    return this.raws.get(id) ?? '';
  }

  // ── recompute ──

  recompute(
    changed: CellId[],
    mode: Mode,
  ): { patch: PatchCell[]; stats: Stats } {
    const start = performance.now();

    // 1. Determine scope
    const scope = new Set<CellId>();
    if (mode === 'naive') {
      // All formula cells + changed
      for (const id of this.asts.keys()) scope.add(id);
      for (const id of changed) scope.add(id);
    } else {
      // Multi-source BFS over rdeps from changed
      const queue: CellId[] = [...changed];
      for (const id of changed) scope.add(id);
      let head = 0;
      while (head < queue.length) {
        const cur = queue[head++];
        const r = this.rdeps.get(cur);
        if (r) {
          for (const dep of r) {
            if (!scope.has(dep)) {
              scope.add(dep);
              queue.push(dep);
            }
          }
        }
      }
    }

    // 2. Kahn topological sort over scope
    // Compute indegree: count deps that are inside scope
    const indegree = new Map<CellId, number>();
    for (const id of scope) {
      const d = this.deps.get(id);
      let count = 0;
      if (d) {
        for (const dep of d) {
          if (scope.has(dep)) count++;
        }
      }
      indegree.set(id, count);
    }

    const kahnQueue: CellId[] = [];
    for (const [id, deg] of indegree) {
      if (deg === 0) kahnQueue.push(id);
    }

    const order: CellId[] = [];
    let kHead = 0;
    while (kHead < kahnQueue.length) {
      const cur = kahnQueue[kHead++];
      order.push(cur);
      const r = this.rdeps.get(cur);
      if (r) {
        for (const dep of r) {
          if (scope.has(dep)) {
            const nd = indegree.get(dep)! - 1;
            indegree.set(dep, nd);
            if (nd === 0) kahnQueue.push(dep);
          }
        }
      }
    }

    // 3. Stuck cells = in scope but not in order (cyclic)
    const ordered = new Set(order);
    const stuck = new Set<CellId>();
    for (const id of scope) {
      if (!ordered.has(id)) stuck.add(id);
    }

    // Tarjan SCC on stuck set
    const cyclic = new Set<CellId>();
    if (stuck.size > 0) {
      const sccs = this.tarjanSCCs(stuck);
      for (const scc of sccs) {
        if (scc.length > 1) {
          for (const id of scc) cyclic.add(id);
        } else {
          // single node: cyclic only if self-loop
          const id = scc[0];
          const d = this.deps.get(id);
          if (d && d.has(id)) cyclic.add(id);
        }
      }
    }

    // Mark cyclic cells
    for (const id of cyclic) {
      this.results.set(id, { v: null, e: '#CIRCULAR!' });
    }

    // Remaining stuck (not cyclic) -> Kahn again, evaluate (errors propagate)
    const stuckNonCyclic: CellId[] = [];
    for (const id of stuck) {
      if (!cyclic.has(id)) stuckNonCyclic.push(id);
    }

    if (stuckNonCyclic.length > 0) {
      // re-run Kahn on these, treating cyclic deps as resolved
      const ind2 = new Map<CellId, number>();
      const sncSet = new Set(stuckNonCyclic);
      for (const id of stuckNonCyclic) {
        const d = this.deps.get(id);
        let count = 0;
        if (d) {
          for (const dep of d) {
            if (sncSet.has(dep)) count++;
          }
        }
        ind2.set(id, count);
      }
      const q2: CellId[] = [];
      for (const [id, deg] of ind2) {
        if (deg === 0) q2.push(id);
      }
      let h2 = 0;
      while (h2 < q2.length) {
        const cur = q2[h2++];
        order.push(cur);
        const r = this.rdeps.get(cur);
        if (r) {
          for (const dep of r) {
            if (sncSet.has(dep)) {
              const nd = ind2.get(dep)! - 1;
              ind2.set(dep, nd);
              if (nd === 0) q2.push(dep);
            }
          }
        }
      }
    }

    // 4. Evaluate in order
    const get = (id: CellId): Result => this.results.get(id) ?? EMPTY;
    // Save old results for diffing
    const oldResults = new Map<CellId, Result>();
    for (const id of scope) {
      const r = this.results.get(id);
      oldResults.set(id, r ?? EMPTY);
    }

    for (const id of order) {
      if (cyclic.has(id)) continue; // already set to #CIRCULAR!
      const ast = this.asts.get(id);
      if (ast) {
        const result = evaluate(ast, get);
        this.results.set(id, result);
      } else {
        // non-formula cell: value from raw
        const raw = this.raws.get(id);
        if (raw === undefined) {
          this.results.delete(id);
        } else if (raw.startsWith('=')) {
          // Formula that failed to parse — error is #VALUE!
          this.results.set(id, { v: null, e: '#VALUE!' });
        } else {
          this.results.set(id, parseRaw(raw));
        }
      }
    }

    // 5. Patch: only cells whose Result changed
    const patch: PatchCell[] = [];
    for (const id of scope) {
      const oldR = oldResults.get(id) ?? EMPTY;
      const newR = this.results.get(id) ?? EMPTY;
      if (oldR.v !== newR.v || oldR.e !== newR.e) {
        patch.push([id, newR.v, newR.e]);
      }
    }

    // 6. Stats
    const stats: Stats = {
      scope: scope.size,
      populated: this.raws.size,
      ms: performance.now() - start,
      mode,
    };

    return { patch, stats };
  }

  // ── Tarjan SCC ──

  private tarjanSCCs(subset: Set<CellId>): CellId[][] {
    let index = 0;
    const indices = new Map<CellId, number>();
    const lowlinks = new Map<CellId, number>();
    const onStack = new Set<CellId>();
    const stack: CellId[] = [];
    const sccs: CellId[][] = [];

    const strongConnect = (v: CellId): void => {
      indices.set(v, index);
      lowlinks.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);

      const d = this.deps.get(v);
      if (d) {
        for (const w of d) {
          if (!subset.has(w)) continue;
          if (!indices.has(w)) {
            strongConnect(w);
            lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
          } else if (onStack.has(w)) {
            lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
          }
        }
      }

      if (lowlinks.get(v) === indices.get(v)) {
        const scc: CellId[] = [];
        let w: CellId;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);
        sccs.push(scc);
      }
    };

    for (const v of subset) {
      if (!indices.has(v)) strongConnect(v);
    }
    return sccs;
  }
}
