import { Engine } from './engine';
import type { CellId } from './types';

function colLetter(c: number): string {
  return String.fromCharCode(65 + c);
}

function bench(label: string, fn: () => number): void {
  // Warmup
  fn();
  fn();

  const runs = 10;
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    times.push(fn());
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(runs / 2)];
  console.log(`${label}: ${median.toFixed(2)} ms (median of ${runs})`);
}

// (a) 10,000-cell fan-out: B1:K1000 = $A$1 * n
function benchFanOut(): number {
  const e = new Engine();
  e.setRaw('A1', '1');

  // B1:K1000 = $A$1 * n  (10 cols x 1000 rows = 10,000 cells)
  const allCells: CellId[] = ['A1'];
  for (let r = 1; r <= 1000; r++) {
    for (let c = 1; c <= 10; c++) {
      const id = colLetter(c) + r;
      const n = (r - 1) * 10 + c;
      e.setRaw(id, `=$A$1*${n}`);
      allCells.push(id);
    }
  }
  e.recompute(allCells, 'naive');

  // Now benchmark one edit to A1
  e.setRaw('A1', '2');
  const start = performance.now();
  e.recompute(['A1'], 'inc');
  return performance.now() - start;
}

// (b) 1,000-deep chain: A1=1, A2=A1+1, A3=A2+1, ...
function benchChain(): number {
  const e = new Engine();
  e.setRaw('A1', '1');
  const allCells: CellId[] = ['A1'];
  for (let r = 2; r <= 1000; r++) {
    const id = 'A' + r;
    e.setRaw(id, `=A${r - 1}+1`);
    allCells.push(id);
  }
  e.recompute(allCells, 'naive');

  // Now benchmark one edit to A1
  e.setRaw('A1', '100');
  const start = performance.now();
  e.recompute(['A1'], 'inc');
  return performance.now() - start;
}

bench('Fan-out 10k', benchFanOut);
bench('Chain 1k', benchChain);
