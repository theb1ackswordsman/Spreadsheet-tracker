import { describe, it, expect, vi } from 'vitest';
import { applyPatch, getCell, getMeta, subscribeCell, subscribeMeta } from './store';
import type { PatchCell, Stats } from '../engine/types';

const mkStats = (overrides?: Partial<Stats>): Stats => ({
  scope: 1,
  populated: 1,
  ms: 0.1,
  mode: 'inc',
  ...overrides,
});

describe('store', () => {
  it('applies patch and returns updated cell', () => {
    const cells: PatchCell[] = [['Z1', 42, null]];
    applyPatch(cells, mkStats());
    expect(getCell('Z1')).toEqual({ v: 42, e: null });
  });

  it('returns frozen EMPTY for unknown cells', () => {
    const r = getCell('Q99');
    expect(r).toEqual({ v: null, e: null });
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('notifies cell subscribers on change', () => {
    const cb = vi.fn();
    const unsub = subscribeCell('B1', cb);

    applyPatch([['B1', 10, null]], mkStats());
    expect(cb).toHaveBeenCalledTimes(1);

    // Same value again: no notification
    applyPatch([['B1', 10, null]], mkStats());
    expect(cb).toHaveBeenCalledTimes(1);

    // Different value: notified
    applyPatch([['B1', 20, null]], mkStats());
    expect(cb).toHaveBeenCalledTimes(2);

    unsub();
    applyPatch([['B1', 30, null]], mkStats());
    // After unsub, no more notifications
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('notifies meta subscribers on any change', () => {
    const cb = vi.fn();
    const unsub = subscribeMeta(cb);

    applyPatch([['C1', 5, null]], mkStats());
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    applyPatch([['C1', 6, null]], mkStats());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('increments version on each applyPatch', () => {
    const v0 = getMeta().version;
    applyPatch([['D1', 1, null]], mkStats());
    expect(getMeta().version).toBe(v0 + 1);
    applyPatch([['D1', 2, null]], mkStats());
    expect(getMeta().version).toBe(v0 + 2);
  });

  it('replaces Result only on actual value change', () => {
    applyPatch([['E1', 100, null]], mkStats());
    const ref1 = getCell('E1');
    // Same patch: ref should be stable
    applyPatch([['E1', 100, null]], mkStats());
    const ref2 = getCell('E1');
    expect(ref1).toBe(ref2); // referential equality

    // Different value: new object
    applyPatch([['E1', 200, null]], mkStats());
    const ref3 = getCell('E1');
    expect(ref3).not.toBe(ref1);
    expect(ref3).toEqual({ v: 200, e: null });
  });
});
