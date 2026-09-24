import type { Edit } from '../engine/types';
import { setRawMirror } from './store';
import { apply } from './bridge';
import { sendEdit } from './socket';

/**
 * Single commit point for all cell edits.
 * Updates store.raw, calls bridge.apply, sends EDIT to server.
 */
export function commitEdits(edits: Edit[]): void {
  // Optimistic local apply
  for (const edit of edits) {
    setRawMirror(edit.cell, edit.raw);
  }
  apply(edits);
  // Send to server
  sendEdit(edits);
}
