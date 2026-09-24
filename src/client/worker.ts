import { Engine } from '../engine/engine';
import type { ToWorker, FromWorker, CellId, Mode } from '../engine/types';

const engine = new Engine();

// Coalesce messages per tick: buffer incoming messages, process all at end of microtask
let pendingMessages: ToWorker[] = [];
let flushScheduled = false;

function scheduleFlush(): void {
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flush);
  }
}

function flush(): void {
  flushScheduled = false;
  const batch = pendingMessages;
  pendingMessages = [];

  // Collect all edits and determine mode
  let mode: Mode = 'inc';
  const allChanged: CellId[] = [];

  for (const msg of batch) {
    try {
      if (msg.t === 'INIT') {
        engine.loadAll(msg.cells);
        // After INIT, recompute everything in naive mode
        const changed: CellId[] = [];
        for (const [id] of msg.cells) changed.push(id);
        const { patch, stats } = engine.recompute(changed, 'naive');
        const reply: FromWorker = { t: 'PATCH', cells: patch, stats };
        self.postMessage(reply);
        // INIT is standalone; skip merging with APPLY
        continue;
      }

      if (msg.t === 'APPLY') {
        if (msg.mode === 'naive') mode = 'naive';
        for (const edit of msg.edits) {
          engine.setRaw(edit.cell, edit.raw);
          allChanged.push(edit.cell);
        }
      }
    } catch (err: unknown) {
      console.error('[worker] error handling message:', err);
    }
  }

  // If we collected any APPLY edits, recompute once
  if (allChanged.length > 0) {
    try {
      const { patch, stats } = engine.recompute(allChanged, mode);
      const reply: FromWorker = { t: 'PATCH', cells: patch, stats };
      self.postMessage(reply);
    } catch (err: unknown) {
      console.error('[worker] recompute error:', err);
    }
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  try {
    pendingMessages.push(e.data);
    scheduleFlush();
  } catch (err: unknown) {
    console.error('[worker] onmessage error:', err);
  }
};
