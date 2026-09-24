import { describe, it, expect } from 'vitest';
import { Engine } from './engine';

describe('hostile formula inputs', () => {
  it('SUM(A1:ZZ99999) → error (out of bounds / unparseable)', () => {
    const e = new Engine();
    // Set some initial value so there's a "before" state
    e.setRaw('A1', '42');
    e.recompute(['A1'], 'inc');

    // Now set the hostile formula
    e.setRaw('A1', '=SUM(A1:ZZ99999)');
    const { patch } = e.recompute(['A1'], 'inc');
    const a1 = patch.find(([id]) => id === 'A1');
    expect(a1).toBeDefined();
    // ZZ is not a valid single-letter ref, so tokenizer fails → #VALUE!
    expect(a1![2]).toBeTruthy(); // has an error
  });

  it('100-deep parentheses → #VALUE! (depth guard)', () => {
    const e = new Engine();
    // Set some initial value so there's a "before" state
    e.setRaw('A1', '42');
    e.recompute(['A1'], 'inc');

    const open = '('.repeat(100);
    const close = ')'.repeat(100);
    e.setRaw('A1', `=${open}1${close}`);
    const { patch } = e.recompute(['A1'], 'inc');
    const a1 = patch.find(([id]) => id === 'A1');
    expect(a1).toBeDefined();
    expect(a1![2]).toBe('#VALUE!');
  });

  it('engine survives and continues working after hostile formulas', () => {
    const e = new Engine();
    e.setRaw('A1', '=SUM(A1:ZZ99999)');
    e.recompute(['A1'], 'naive');

    e.setRaw('A1', '=1+2');
    const { patch } = e.recompute(['A1'], 'inc');
    const a1 = patch.find(([id]) => id === 'A1');
    expect(a1).toBeDefined();
    expect(a1![1]).toBe(3);
    expect(a1![2]).toBe(null);
  });
});
