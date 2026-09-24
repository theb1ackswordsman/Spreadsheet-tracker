import type { Edit } from '../engine/types';
import { commitEdits } from './commit';
import { getRaw } from './store';

const STRESS_COLS = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
const BATCH_SIZE = 2000;

/** Check if stress data is currently loaded */
export function isStressLoaded(): boolean {
  return getRaw('M1000') !== '';
}

/**
 * Generate 11,004 stress edits:
 * - A1 = 1
 * - B1:K1000 = =$A$1*<col number> (10,000 formulas, fan-out from A1)
 * - M1 = =A1, M2..M1000 = =M<prev>+1 (1,000-deep chain from A1)
 * - O1 = 5, P1 = =O1*2, Q1 = =P1+1 (independent 3-cell chain)
 */
export function generateStressEdits(): Edit[] {
  const edits: Edit[] = [];

  // A1 = 1
  edits.push({ cell: 'A1', raw: '1' });

  // B1:K1000 = =$A$1*<col number>
  for (let c = 0; c < STRESS_COLS.length; c++) {
    const colLetter = STRESS_COLS[c]!;
    const colNum = c + 2; // B=2 .. K=11
    for (let r = 1; r <= 1000; r++) {
      edits.push({ cell: `${colLetter}${r}`, raw: `=$A$1*${colNum}` });
    }
  }

  // M1 = =A1, M2..M1000 = =M<prev>+1
  edits.push({ cell: 'M1', raw: '=A1' });
  for (let r = 2; r <= 1000; r++) {
    edits.push({ cell: `M${r}`, raw: `=M${r - 1}+1` });
  }

  // O1 = 5, P1 = =O1*2, Q1 = =P1+1
  edits.push({ cell: 'O1', raw: '5' });
  edits.push({ cell: 'P1', raw: '=O1*2' });
  edits.push({ cell: 'Q1', raw: '=P1+1' });

  return edits;
}

/** Generate clearing edits for all 11,004 stress cells */
export function generateClearStressEdits(): Edit[] {
  const edits: Edit[] = [];
  edits.push({ cell: 'A1', raw: '' });
  for (let c = 0; c < STRESS_COLS.length; c++) {
    const colLetter = STRESS_COLS[c]!;
    for (let r = 1; r <= 1000; r++) {
      edits.push({ cell: `${colLetter}${r}`, raw: '' });
    }
  }
  for (let r = 1; r <= 1000; r++) {
    edits.push({ cell: `M${r}`, raw: '' });
  }
  edits.push({ cell: 'O1', raw: '' });
  edits.push({ cell: 'P1', raw: '' });
  edits.push({ cell: 'Q1', raw: '' });
  return edits;
}

/** Send stress test edits in batches of <= 2000 */
export async function sendStressData(): Promise<void> {
  const edits = generateStressEdits();
  for (let i = 0; i < edits.length; i += BATCH_SIZE) {
    const batch = edits.slice(i, i + BATCH_SIZE);
    commitEdits(batch, { silent: true });
    if (i + BATCH_SIZE < edits.length) {
      await new Promise(r => setTimeout(r, 60));
    }
  }
}

/** Clear all stress test cells in batches of <= 2000 */
export async function clearStressData(): Promise<void> {
  const edits = generateClearStressEdits();
  for (let i = 0; i < edits.length; i += BATCH_SIZE) {
    const batch = edits.slice(i, i + BATCH_SIZE);
    commitEdits(batch, { silent: true });
    if (i + BATCH_SIZE < edits.length) {
      await new Promise(r => setTimeout(r, 60));
    }
  }
}
