import { describe, expect, it } from 'vitest';
import { COLS, ROWS } from './constants';

describe('sanity', () => {
  it('constants are defined correctly', () => {
    expect(COLS).toBe(26);
    expect(ROWS).toBe(1000);
  });
});
