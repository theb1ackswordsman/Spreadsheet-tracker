import { describe, it, expect } from 'vitest';
import { Engine } from './engine';
import type { CellId, Result } from './types';

// ── Seeded PRNG (xoshiro128** variant, deterministic) ──

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Cell grid: A1:H8 = 64 cells ──

const CELLS: CellId[] = [];
for (let r = 1; r <= 8; r++) {
  for (let c = 0; c < 8; c++) {
    CELLS.push(String.fromCharCode(65 + c) + r);
  }
}

// ── Random edit generators ──

function randomCell(rng: () => number): CellId {
  return CELLS[Math.floor(rng() * CELLS.length)];
}

function randomRef(rng: () => number): string {
  const c = randomCell(rng);
  // sometimes use $ notation
  if (rng() < 0.3) return '$' + c[0] + '$' + c.slice(1);
  return c;
}

function randomRange(rng: () => number): string {
  return randomRef(rng) + ':' + randomRef(rng);
}

function randomFormula(rng: () => number): string {
  const r = rng();
  if (r < 0.2) {
    // simple ref
    return '=' + randomRef(rng);
  } else if (r < 0.4) {
    // binary op
    const ops = ['+', '-', '*', '/'];
    const op = ops[Math.floor(rng() * ops.length)];
    return '=' + randomRef(rng) + op + randomRef(rng);
  } else if (r < 0.6) {
    // aggregate function on range
    const fns = ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'];
    const fn = fns[Math.floor(rng() * fns.length)];
    return '=' + fn + '(' + randomRange(rng) + ')';
  } else if (r < 0.75) {
    // chain of ops
    return '=' + randomRef(rng) + '+' + randomRef(rng) + '*' + randomRef(rng);
  } else {
    // nested function
    const fns = ['SUM', 'MIN', 'MAX'];
    const fn = fns[Math.floor(rng() * fns.length)];
    return '=' + fn + '(' + randomRef(rng) + ',' + randomRef(rng) + ')';
  }
}

function randomRaw(rng: () => number): string {
  const r = rng();
  if (r < 0.10) {
    // clear
    return '';
  } else if (r < 0.30) {
    // number
    return String(Math.floor(rng() * 200) - 100);
  } else if (r < 0.40) {
    // text
    return 'txt' + Math.floor(rng() * 100);
  } else if (r < 0.50) {
    // deliberate self-cycle
    const c = randomCell(rng);
    return '=' + c + '+1';
  } else {
    // formula
    return randomFormula(rng);
  }
}

// ── Snapshot helper: extract full state from engine ──

function snapshot(e: Engine, cells: CellId[]): Map<CellId, Result> {
  const m = new Map<CellId, Result>();
  for (const id of cells) {
    const r = e.getResult(id);
    // Only record non-empty results to keep comparison simple
    if (r.v !== null || r.e !== null) {
      m.set(id, { v: r.v, e: r.e });
    }
  }
  return m;
}

function snapshotToSorted(m: Map<CellId, Result>): [CellId, Result][] {
  return [...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

// ── Oracle test ──

describe('Oracle', () => {
  it('10,000 random sequences: incremental == naive', () => {
    const rng = mulberry32(42);
    const SEQ_COUNT = 10_000;
    const MAX_EDITS_PER_SEQ = 12;

    for (let seq = 0; seq < SEQ_COUNT; seq++) {
      const inc = new Engine();
      const numEdits = Math.floor(rng() * MAX_EDITS_PER_SEQ) + 1;

      // Track all current raws
      const raws = new Map<CellId, string>();

      for (let step = 0; step < numEdits; step++) {
        const cell = randomCell(rng);
        const raw = randomRaw(rng);

        // Apply to incremental engine
        inc.setRaw(cell, raw);
        inc.recompute([cell], 'inc');

        // Track raws
        if (raw === '') {
          raws.delete(cell);
        } else {
          raws.set(cell, raw);
        }

        // Build a fresh naive engine from current raws
        const naive = new Engine();
        const entries: [CellId, string][] = [...raws.entries()];
        naive.loadAll(entries);
        const allCells = entries.map(e => e[0]);
        naive.recompute(allCells, 'naive');

        // Compare every cell
        const incSnap = snapshot(inc, CELLS);
        const naiveSnap = snapshot(naive, CELLS);

        const incSorted = snapshotToSorted(incSnap);
        const naiveSorted = snapshotToSorted(naiveSnap);

        // Check same set of non-empty results
        if (incSorted.length !== naiveSorted.length) {
          expect.fail(
            `Seq ${seq}, step ${step}: snapshot size mismatch. ` +
            `Inc has ${incSorted.length} cells, naive has ${naiveSorted.length}. ` +
            `Cell=${cell}, raw="${raw}". ` +
            `Raws: ${JSON.stringify([...raws.entries()])}. ` +
            `Inc: ${JSON.stringify(incSorted)}. ` +
            `Naive: ${JSON.stringify(naiveSorted)}`
          );
        }

        for (let i = 0; i < incSorted.length; i++) {
          const [iId, iRes] = incSorted[i];
          const [nId, nRes] = naiveSorted[i];
          if (iId !== nId || iRes.v !== nRes.v || iRes.e !== nRes.e) {
            expect.fail(
              `Seq ${seq}, step ${step}: mismatch at cell. ` +
              `Inc[${iId}]=${JSON.stringify(iRes)}, Naive[${nId}]=${JSON.stringify(nRes)}. ` +
              `Cell=${cell}, raw="${raw}". ` +
              `Raws: ${JSON.stringify([...raws.entries()])}`
            );
          }
        }
      }
    }
  }, 60_000); // 60s timeout safety margin
});
