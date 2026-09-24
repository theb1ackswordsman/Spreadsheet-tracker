import type { Edit } from '../engine/types';
import { setRawMirror } from './store';
import { apply } from './bridge';

/**
 * Single commit point for all cell edits.
 * Updates store.raw, calls bridge.apply.
 * P3 will add socket send here.
 */
export function commitEdits(edits: Edit[]): void {
  for (const edit of edits) {
    setRawMirror(edit.cell, edit.raw);
  }
  apply(edits);
}
