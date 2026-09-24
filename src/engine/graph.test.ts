import { describe, it, expect } from 'vitest';
import { Engine } from './engine';

function val(engine: Engine, id: string) {
  return engine.getResult(id);
}

describe('Engine', () => {
  it('chain: C1=A1+B1, D1=C1*2', () => {
    const e = new Engine();
    e.setRaw('A1', '3');
    e.setRaw('B1', '4');
    e.setRaw('C1', '=A1+B1');
    e.setRaw('D1', '=C1*2');
    e.recompute(['A1', 'B1', 'C1', 'D1'], 'naive');
    expect(val(e, 'C1')).toEqual({ v: 7, e: null });
    expect(val(e, 'D1')).toEqual({ v: 14, e: null });

    // incremental edit
    e.setRaw('A1', '10');
    const { patch } = e.recompute(['A1'], 'inc');
    expect(val(e, 'C1')).toEqual({ v: 14, e: null });
    expect(val(e, 'D1')).toEqual({ v: 28, e: null });
    // patch should include C1 and D1 (changed), possibly A1
    const ids = patch.map(p => p[0]);
    expect(ids).toContain('C1');
    expect(ids).toContain('D1');
  });

  it('diamond dependency', () => {
    // A1 -> B1, A1 -> C1, B1+C1 -> D1
    const e = new Engine();
    e.setRaw('A1', '5');
    e.setRaw('B1', '=A1+1');
    e.setRaw('C1', '=A1+2');
    e.setRaw('D1', '=B1+C1');
    e.recompute(['A1', 'B1', 'C1', 'D1'], 'naive');
    expect(val(e, 'B1')).toEqual({ v: 6, e: null });
    expect(val(e, 'C1')).toEqual({ v: 7, e: null });
    expect(val(e, 'D1')).toEqual({ v: 13, e: null });

    e.setRaw('A1', '10');
    e.recompute(['A1'], 'inc');
    expect(val(e, 'B1')).toEqual({ v: 11, e: null });
    expect(val(e, 'C1')).toEqual({ v: 12, e: null });
    expect(val(e, 'D1')).toEqual({ v: 23, e: null });
  });

  it('fan-out', () => {
    const e = new Engine();
    e.setRaw('A1', '1');
    e.setRaw('B1', '=A1*2');
    e.setRaw('C1', '=A1*3');
    e.setRaw('D1', '=A1*4');
    e.recompute(['A1', 'B1', 'C1', 'D1'], 'naive');
    expect(val(e, 'B1')).toEqual({ v: 2, e: null });
    expect(val(e, 'C1')).toEqual({ v: 3, e: null });
    expect(val(e, 'D1')).toEqual({ v: 4, e: null });

    e.setRaw('A1', '10');
    e.recompute(['A1'], 'inc');
    expect(val(e, 'B1')).toEqual({ v: 20, e: null });
    expect(val(e, 'C1')).toEqual({ v: 30, e: null });
    expect(val(e, 'D1')).toEqual({ v: 40, e: null });
  });

  it('self-cycle', () => {
    const e = new Engine();
    e.setRaw('A1', '=A1+1');
    e.recompute(['A1'], 'naive');
    expect(val(e, 'A1')).toEqual({ v: null, e: '#CIRCULAR!' });
  });

  it('2-cycle', () => {
    const e = new Engine();
    e.setRaw('A1', '=B1');
    e.setRaw('B1', '=A1');
    e.recompute(['A1', 'B1'], 'naive');
    expect(val(e, 'A1')).toEqual({ v: null, e: '#CIRCULAR!' });
    expect(val(e, 'B1')).toEqual({ v: null, e: '#CIRCULAR!' });
  });

  it('3-cycle', () => {
    const e = new Engine();
    e.setRaw('A1', '=C1');
    e.setRaw('B1', '=A1');
    e.setRaw('C1', '=B1');
    e.recompute(['A1', 'B1', 'C1'], 'naive');
    expect(val(e, 'A1')).toEqual({ v: null, e: '#CIRCULAR!' });
    expect(val(e, 'B1')).toEqual({ v: null, e: '#CIRCULAR!' });
    expect(val(e, 'C1')).toEqual({ v: null, e: '#CIRCULAR!' });
  });

  it('downstream-of-cycle shows error', () => {
    const e = new Engine();
    e.setRaw('A1', '=B1');
    e.setRaw('B1', '=A1');
    e.setRaw('C1', '=A1+1');
    e.recompute(['A1', 'B1', 'C1'], 'naive');
    expect(val(e, 'A1').e).toBe('#CIRCULAR!');
    expect(val(e, 'B1').e).toBe('#CIRCULAR!');
    // C1 depends on cyclic A1: error propagates
    expect(val(e, 'C1').e).not.toBeNull();
  });

  it('breaking a cycle recovers all', () => {
    const e = new Engine();
    e.setRaw('A1', '=B1');
    e.setRaw('B1', '=A1');
    e.recompute(['A1', 'B1'], 'naive');
    expect(val(e, 'A1').e).toBe('#CIRCULAR!');
    expect(val(e, 'B1').e).toBe('#CIRCULAR!');

    // Break the cycle: B1 = 5
    e.setRaw('B1', '5');
    e.recompute(['B1'], 'inc');
    expect(val(e, 'B1')).toEqual({ v: 5, e: null });
    expect(val(e, 'A1')).toEqual({ v: 5, e: null });
  });

  it('editing an EMPTY cell inside a SUM range updates the SUM', () => {
    const e = new Engine();
    e.setRaw('D1', '=SUM(A1:C1)');
    e.recompute(['D1'], 'naive');
    expect(val(e, 'D1')).toEqual({ v: 0, e: null });

    // Set A1 (was empty, inside the range)
    e.setRaw('A1', '10');
    e.recompute(['A1'], 'inc');
    expect(val(e, 'D1')).toEqual({ v: 10, e: null });

    e.setRaw('B1', '20');
    e.recompute(['B1'], 'inc');
    expect(val(e, 'D1')).toEqual({ v: 30, e: null });
  });

  it('clearing a cell', () => {
    const e = new Engine();
    e.setRaw('A1', '5');
    e.setRaw('B1', '=A1+1');
    e.recompute(['A1', 'B1'], 'naive');
    expect(val(e, 'B1')).toEqual({ v: 6, e: null });

    // Clear A1
    e.setRaw('A1', '');
    e.recompute(['A1'], 'inc');
    // A1 is now empty (null), in arithmetic empty=0
    expect(val(e, 'B1')).toEqual({ v: 1, e: null });
    expect(val(e, 'A1')).toEqual({ v: null, e: null });
  });

  it('idempotent setRaw: same raw -> empty patch', () => {
    const e = new Engine();
    e.setRaw('A1', '5');
    e.setRaw('B1', '=A1+1');
    e.recompute(['A1', 'B1'], 'naive');

    // Set A1 again with same value
    e.setRaw('A1', '5');
    const { patch } = e.recompute(['A1'], 'inc');
    expect(patch).toEqual([]);
  });

  it('loadAll works correctly', () => {
    const e = new Engine();
    e.loadAll([
      ['A1', '2'],
      ['B1', '3'],
      ['C1', '=A1+B1'],
    ]);
    e.recompute(['A1', 'B1', 'C1'], 'naive');
    expect(val(e, 'C1')).toEqual({ v: 5, e: null });
  });

  it('stats are returned', () => {
    const e = new Engine();
    e.setRaw('A1', '1');
    const { stats } = e.recompute(['A1'], 'inc');
    expect(stats.scope).toBeGreaterThanOrEqual(1);
    expect(stats.populated).toBe(1);
    expect(stats.mode).toBe('inc');
    expect(typeof stats.ms).toBe('number');
  });

  it('naive mode includes all formula cells in scope', () => {
    const e = new Engine();
    e.setRaw('A1', '1');
    e.setRaw('B1', '=A1');
    e.setRaw('C1', '=A1');
    e.setRaw('Z1', '=A1');
    e.recompute(['A1', 'B1', 'C1', 'Z1'], 'naive');

    // Only change A1 in naive: scope should include all formula cells
    e.setRaw('A1', '2');
    const { stats } = e.recompute(['A1'], 'naive');
    // 3 formula cells + 1 changed = at least 4
    expect(stats.scope).toBeGreaterThanOrEqual(4);
  });
});
