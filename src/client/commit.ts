import type { Edit } from '../engine/types';
import { setRawMirror, setSilentEdits } from './store';
import { apply } from './bridge';
import { sendEdit } from './socket';

export interface CommitOptions {
  silent?: boolean;
}

/**
 * Single commit point for all cell edits.
 * Updates store.raw, calls bridge.apply, sends EDIT to server.
 */
export function commitEdits(edits: Edit[], options?: CommitOptions): void {
  if (options?.silent) {
    setSilentEdits(true);
  }
  try {
    // Optimistic local apply
    for (const edit of edits) {
      setRawMirror(edit.cell, edit.raw);
    }
    apply(edits);
    // Send to server
    sendEdit(edits);
  } finally {
    if (options?.silent) {
      setSilentEdits(false);
    }
  }
}
