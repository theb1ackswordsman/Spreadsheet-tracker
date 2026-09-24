import { COLS, ROWS } from '../engine/constants';
import type { CellId } from '../engine/types';

// ── Types ──

export type NavMode = 'navigate' | 'edit';

export interface NavState {
  col: number; // 0-based, 0..COLS-1
  row: number; // 0-based, 0..ROWS-1
  mode: NavMode;
}

export type NavAction =
  | { t: 'ARROW'; dc: number; dr: number }
  | { t: 'TAB'; shift: boolean }
  | { t: 'ENTER'; shift: boolean }
  | { t: 'CLICK'; col: number; row: number }
  | { t: 'SET_MODE'; mode: NavMode };

// ── Helpers ──

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/** Convert 0-based col/row to CellId like "A1" */
export function toCellId(col: number, row: number): CellId {
  return String.fromCharCode(65 + col) + String(row + 1);
}

/** Convert CellId back to 0-based col/row */
export function fromCellId(id: CellId): { col: number; row: number } {
  const col = id.charCodeAt(0) - 65;
  const row = parseInt(id.slice(1), 10) - 1;
  return { col, row };
}

/** Column header label: A..Z */
export function colLabel(col: number): string {
  return String.fromCharCode(65 + col);
}

// ── Initial state ──

export function initNav(): NavState {
  return { col: 0, row: 0, mode: 'navigate' };
}

// ── Pure reducer ──

export function reduce(state: NavState, action: NavAction): NavState {
  switch (action.t) {
    case 'ARROW': {
      if (state.mode !== 'navigate') return state;
      const col = clamp(state.col + action.dc, 0, COLS - 1);
      const row = clamp(state.row + action.dr, 0, ROWS - 1);
      if (col === state.col && row === state.row) return state;
      return { ...state, col, row };
    }

    case 'TAB': {
      if (state.mode !== 'navigate') return state;
      const dc = action.shift ? -1 : 1;
      let col = state.col + dc;
      let row = state.row;
      if (col < 0) {
        col = COLS - 1;
        row = row - 1;
      } else if (col >= COLS) {
        col = 0;
        row = row + 1;
      }
      col = clamp(col, 0, COLS - 1);
      row = clamp(row, 0, ROWS - 1);
      return { ...state, col, row };
    }

    case 'ENTER': {
      if (state.mode !== 'navigate') return state;
      const dr = action.shift ? -1 : 1;
      const row = clamp(state.row + dr, 0, ROWS - 1);
      if (row === state.row) return state;
      return { ...state, row };
    }

    case 'CLICK': {
      const col = clamp(action.col, 0, COLS - 1);
      const row = clamp(action.row, 0, ROWS - 1);
      return { col, row, mode: 'navigate' };
    }

    case 'SET_MODE':
      return { ...state, mode: action.mode };
  }
}
