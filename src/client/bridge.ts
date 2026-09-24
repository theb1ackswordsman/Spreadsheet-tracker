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

// ── Dev-only console verification ──

if (import.meta.env.DEV) {
  setTimeout(() => {
    console.log('[bridge/dev] applying test edits...');
    apply([{ cell: 'A1', raw: '10' }]);
    apply([{ cell: 'A2', raw: '20' }]);
    apply([{ cell: 'A3', raw: '=A1+A2' }]);

    // Log after two frames so the PATCH has been applied
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        console.log('[bridge/dev] A1 =', getCell('A1'));
        console.log('[bridge/dev] A2 =', getCell('A2'));
        console.log('[bridge/dev] A3 =', getCell('A3'));
        console.log('[bridge/dev] meta =', getMeta());
      });
    });
  }, 500);
}
