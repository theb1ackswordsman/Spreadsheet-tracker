import { describe, it, expect } from 'vitest';
import {
  generateStressEdits,
  generateClearStressEdits,
  isStressLoaded,
} from './stress';
import {
  getEvalMode,
  setEvalMode,
  getRtt,
  recordRtt,
  bumpRenderCount,
  getRenderCount,
  resetRenderCount,
  getMeta,
} from './store';

describe('stress test data', () => {
  it('generates 11,001 stress edits (A1 + 10,000 formulas + 1,000 chain)', () => {
    const edits = generateStressEdits();
    expect(edits.length).toBe(11001);

    // A1 = 1
    const a1 = edits.find(e => e.cell === 'A1');
    expect(a1).toBeDefined();
    expect(a1!.raw).toBe('1');

    // B1 has =$A$1*2
    const b1 = edits.find(e => e.cell === 'B1');
    expect(b1).toBeDefined();
    expect(b1!.raw).toBe('=$A$1*2');

    // K1000 has =$A$1*11
    const k1000 = edits.find(e => e.cell === 'K1000');
    expect(k1000).toBeDefined();
    expect(k1000!.raw).toBe('=$A$1*11');

    // M1 has =A1
    const m1 = edits.find(e => e.cell === 'M1');
    expect(m1).toBeDefined();
    expect(m1!.raw).toBe('=A1');

    // M2 has =M1+1
    const m2 = edits.find(e => e.cell === 'M2');
    expect(m2).toBeDefined();
    expect(m2!.raw).toBe('=M1+1');

    // M1000 has =M999+1
    const m1000 = edits.find(e => e.cell === 'M1000');
    expect(m1000).toBeDefined();
    expect(m1000!.raw).toBe('=M999+1');
  });

  it('generates 11,001 clearing edits with raw: ""', () => {
    const clearEdits = generateClearStressEdits();
    expect(clearEdits.length).toBe(11001);
    for (const edit of clearEdits) {
      expect(edit.raw).toBe('');
    }
  });

  it('reports isStressLoaded false when M1000 is empty', () => {
    expect(isStressLoaded()).toBe(false);
  });
});

describe('performance metrics in store', () => {
  it('tracks evaluation mode locally', () => {
    expect(getEvalMode()).toBe('inc');
    setEvalMode('naive');
    expect(getEvalMode()).toBe('naive');
    expect(getMeta().evalMode).toBe('naive');
    setEvalMode('inc');
    expect(getEvalMode()).toBe('inc');
  });

  it('measures smoothed RTT via EMA', () => {
    // Initial is null (dash)
    expect(getRtt()).toBeNull();
    recordRtt(50);
    expect(getRtt()).toBe(50);
    // Second sample: 0.2 * 100 + 0.8 * 50 = 60
    recordRtt(100);
    expect(getRtt()).toBeCloseTo(60, 5);
  });

  it('render counter increments in all builds', () => {
    const before = getRenderCount();
    bumpRenderCount();
    expect(getRenderCount()).toBe(before + 1);
    resetRenderCount();
    expect(getRenderCount()).toBe(0);
  });
});
