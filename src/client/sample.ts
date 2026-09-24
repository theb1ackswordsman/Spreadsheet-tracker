import type { Edit } from '../engine/types';
import { commitEdits } from './commit';
import { subscribeSnapshot } from './store';

export const SAMPLE_EDITS: Edit[] = [
  { cell: 'A1', raw: 'Monthly Budget' },
  { cell: 'A3', raw: 'Rent' },
  { cell: 'B3', raw: '1200' },
  { cell: 'A4', raw: 'Food' },
  { cell: 'B4', raw: '450' },
  { cell: 'A5', raw: 'Utilities' },
  { cell: 'B5', raw: '150' },
  { cell: 'A6', raw: 'Transport' },
  { cell: 'B6', raw: '100' },
  { cell: 'A7', raw: 'Total' },
  { cell: 'B7', raw: '=SUM(B3:B6)' },
  { cell: 'A8', raw: 'Average' },
  { cell: 'B8', raw: '=AVERAGE(B3:B6)' },
  // 3-step dependency chain: B7 -> D3 -> D4 -> D5
  { cell: 'D2', raw: 'Tax Rate' },
  { cell: 'E2', raw: '0.15' },
  { cell: 'D3', raw: '=B7*E2' },
  { cell: 'D4', raw: '=D3+25' },
  { cell: 'D5', raw: '=D4*1.05' },
];

export function sendSampleData(): void {
  commitEdits(SAMPLE_EDITS, { silent: true });
}

// Auto-send once per tab, only when the first SNAPSHOT has v === 0 and no cells.
let autoSent = false;

subscribeSnapshot((v, cellCount) => {
  if (!autoSent && v === 0 && cellCount === 0) {
    autoSent = true;
    sendSampleData();
  }
});
