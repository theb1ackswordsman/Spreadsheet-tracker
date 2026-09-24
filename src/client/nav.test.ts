import { describe, it, expect } from 'vitest';
import { reduce, initNav, toCellId, fromCellId, colLabel } from './nav';
import type { NavState } from './nav';
import { COLS, ROWS } from '../engine/constants';

describe('nav helpers', () => {
  it('toCellId converts col/row to CellId', () => {
    expect(toCellId(0, 0)).toBe('A1');
    expect(toCellId(25, 999)).toBe('Z1000');
    expect(toCellId(1, 4)).toBe('B5');
  });

  it('fromCellId parses CellId back to col/row', () => {
    expect(fromCellId('A1')).toEqual({ col: 0, row: 0 });
    expect(fromCellId('Z1000')).toEqual({ col: 25, row: 999 });
  });

  it('colLabel returns A..Z', () => {
    expect(colLabel(0)).toBe('A');
    expect(colLabel(25)).toBe('Z');
  });
});

describe('nav reduce', () => {
  const base: NavState = { col: 5, row: 10, mode: 'navigate' };

  it('arrow moves within bounds', () => {
    expect(reduce(base, { t: 'ARROW', dc: 1, dr: 0 })).toEqual({ col: 6, row: 10, mode: 'navigate' });
    expect(reduce(base, { t: 'ARROW', dc: 0, dr: -1 })).toEqual({ col: 5, row: 9, mode: 'navigate' });
  });

  it('arrow clamps at grid edges', () => {
    const topLeft: NavState = { col: 0, row: 0, mode: 'navigate' };
    const result = reduce(topLeft, { t: 'ARROW', dc: -1, dr: -1 });
    expect(result).toBe(topLeft); // referential identity when no change
  });

  it('arrow clamps at bottom-right', () => {
    const br: NavState = { col: COLS - 1, row: ROWS - 1, mode: 'navigate' };
    const result = reduce(br, { t: 'ARROW', dc: 1, dr: 1 });
    expect(result).toBe(br);
  });

  it('arrow does nothing in edit mode', () => {
    const editing: NavState = { col: 5, row: 10, mode: 'edit' };
    const result = reduce(editing, { t: 'ARROW', dc: 1, dr: 0 });
    expect(result).toBe(editing);
  });

  it('Tab moves right, wraps to next row', () => {
    const atEnd: NavState = { col: COLS - 1, row: 5, mode: 'navigate' };
    expect(reduce(atEnd, { t: 'TAB', shift: false })).toEqual({ col: 0, row: 6, mode: 'navigate' });
  });

  it('Shift+Tab moves left, wraps to previous row', () => {
    const atStart: NavState = { col: 0, row: 5, mode: 'navigate' };
    expect(reduce(atStart, { t: 'TAB', shift: true })).toEqual({ col: COLS - 1, row: 4, mode: 'navigate' });
  });

  it('Tab at very last cell stays put', () => {
    const last: NavState = { col: COLS - 1, row: ROWS - 1, mode: 'navigate' };
    const result = reduce(last, { t: 'TAB', shift: false });
    expect(result.col).toBe(0);
    expect(result.row).toBe(ROWS - 1); // clamped
  });

  it('Shift+Tab at very first cell stays put', () => {
    const first: NavState = { col: 0, row: 0, mode: 'navigate' };
    const result = reduce(first, { t: 'TAB', shift: true });
    expect(result.col).toBe(COLS - 1);
    expect(result.row).toBe(0); // clamped
  });

  it('Enter moves down, Shift+Enter moves up', () => {
    expect(reduce(base, { t: 'ENTER', shift: false })).toEqual({ col: 5, row: 11, mode: 'navigate' });
    expect(reduce(base, { t: 'ENTER', shift: true })).toEqual({ col: 5, row: 9, mode: 'navigate' });
  });

  it('Enter clamps at boundaries', () => {
    const top: NavState = { col: 5, row: 0, mode: 'navigate' };
    expect(reduce(top, { t: 'ENTER', shift: true })).toStrictEqual({ col: 5, row: 0, mode: 'navigate' });

    const bottom: NavState = { col: 5, row: ROWS - 1, mode: 'navigate' };
    expect(reduce(bottom, { t: 'ENTER', shift: false })).toStrictEqual({ col: 5, row: ROWS - 1, mode: 'navigate' });
  });

  it('click sets col/row and returns to navigate', () => {
    const editing: NavState = { col: 0, row: 0, mode: 'edit' };
    expect(reduce(editing, { t: 'CLICK', col: 10, row: 20 })).toEqual({ col: 10, row: 20, mode: 'navigate' });
  });

  it('click clamps out-of-range values', () => {
    expect(reduce(base, { t: 'CLICK', col: 100, row: -5 })).toEqual({ col: COLS - 1, row: 0, mode: 'navigate' });
  });

  it('SET_MODE changes mode', () => {
    expect(reduce(base, { t: 'SET_MODE', mode: 'edit' })).toEqual({ ...base, mode: 'edit' });
  });

  it('Tab in edit mode commits and moves right', () => {
    const editing: NavState = { col: 5, row: 10, mode: 'edit' };
    expect(reduce(editing, { t: 'TAB', shift: false })).toEqual({ col: 6, row: 10, mode: 'navigate' });
  });

  it('Enter in edit mode commits and moves down', () => {
    const editing: NavState = { col: 5, row: 10, mode: 'edit' };
    expect(reduce(editing, { t: 'ENTER', shift: false })).toEqual({ col: 5, row: 11, mode: 'navigate' });
  });

  it('Shift+Enter in edit mode commits and moves up', () => {
    const editing: NavState = { col: 5, row: 10, mode: 'edit' };
    expect(reduce(editing, { t: 'ENTER', shift: true })).toEqual({ col: 5, row: 9, mode: 'navigate' });
  });

  it('Shift+Tab in edit mode commits and moves left', () => {
    const editing: NavState = { col: 5, row: 10, mode: 'edit' };
    expect(reduce(editing, { t: 'TAB', shift: true })).toEqual({ col: 4, row: 10, mode: 'navigate' });
  });

  it('EDIT_START enters edit mode', () => {
    expect(reduce(base, { t: 'EDIT_START' })).toEqual({ ...base, mode: 'edit' });
  });

  it('EDIT_START is no-op when already editing', () => {
    const editing: NavState = { col: 5, row: 10, mode: 'edit' };
    expect(reduce(editing, { t: 'EDIT_START' })).toBe(editing);
  });

  it('COMMIT returns to navigate from edit mode', () => {
    const editing: NavState = { col: 5, row: 10, mode: 'edit' };
    expect(reduce(editing, { t: 'COMMIT' })).toEqual({ col: 5, row: 10, mode: 'navigate' });
  });

  it('COMMIT is no-op in navigate mode', () => {
    expect(reduce(base, { t: 'COMMIT' })).toBe(base);
  });

  it('CANCEL returns to navigate from edit mode', () => {
    const editing: NavState = { col: 5, row: 10, mode: 'edit' };
    expect(reduce(editing, { t: 'CANCEL' })).toEqual({ col: 5, row: 10, mode: 'navigate' });
  });

  it('CANCEL is no-op in navigate mode', () => {
    expect(reduce(base, { t: 'CANCEL' })).toBe(base);
  });

  it('DELETE returns same state (Grid handles clearing)', () => {
    expect(reduce(base, { t: 'DELETE' })).toBe(base);
  });
});
