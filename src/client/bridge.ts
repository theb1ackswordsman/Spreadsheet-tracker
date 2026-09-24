import type { CellId, Edit, Mode, FromWorker } from '../engine/types';
import { applyPatch, setRawMirror, getCell, getMeta } from './store';

// ── Module-level singleton worker ──

const worker = new Worker(new URL('./worker.ts', import.meta.url), {
  type: 'module',
});

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const msg = e.data;
  if (msg.t === 'PATCH') {
    applyPatch(msg.cells, msg.stats);
  }
};

worker.onerror = (e: ErrorEvent) => {
  console.error('[bridge] worker error:', e.message);
};

// ── Public API ──

export function init(cells: [CellId, string][]): void {
  worker.postMessage({ t: 'INIT', cells });
}

export function apply(edits: Edit[], mode: Mode = 'inc'): void {
  // Update raw mirror optimistically
  for (const edit of edits) {
    setRawMirror(edit.cell, edit.raw);
  }
  worker.postMessage({ t: 'APPLY', edits, mode });
}


