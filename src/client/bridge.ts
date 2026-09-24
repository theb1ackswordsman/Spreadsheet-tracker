import type { CellId, Edit, Mode, FromWorker } from '../engine/types';
import { applyPatch, setRawMirror, getRawMirrorEntries, onEvalModeChange } from './store';

// ── Watchdog timeout ──

const WATCHDOG_TIMEOUT = 2000;

// ── Mode tracking ──

let currentMode: Mode = 'inc';

onEvalModeChange((m) => {
  currentMode = m;
});

export function setEvalMode(mode: Mode): void {
  currentMode = mode;
}

export function getEvalMode(): Mode {
  return currentMode;
}

// ── Module-level singleton worker ──

let worker: Worker | null = null;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let pendingAt: number | null = null; // timestamp of the oldest unanswered message

function createWorker(): Worker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
  });

  w.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data;
    if (msg.t === 'PATCH') {
      // Worker responded: clear watchdog
      pendingAt = null;
      if (watchdogTimer !== null) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
      applyPatch(msg.cells, msg.stats);
    }
  };

  w.onerror = (e: ErrorEvent) => {
    console.error('[bridge] worker error:', e.message);
  };

  return w;
}

function respawnWorker(): void {
  console.warn('[bridge] watchdog: worker timed out, respawning');
  worker?.terminate();
  pendingAt = null;
  if (watchdogTimer !== null) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
  worker = createWorker();

  // Re-init from store's raw mirror
  const cells = getRawMirrorEntries();
  postToWorker({ t: 'INIT', cells });
}

function startWatchdog(): void {
  if (watchdogTimer !== null) return; // already watching
  pendingAt = Date.now();
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null;
    if (pendingAt !== null) {
      respawnWorker();
    }
  }, WATCHDOG_TIMEOUT);
}

function postToWorker(msg: { t: 'INIT'; cells: [CellId, string][] } | { t: 'APPLY'; edits: Edit[]; mode: Mode }): void {
  if (typeof Worker === 'undefined') return;
  if (pendingAt === null) {
    startWatchdog();
  }
  worker?.postMessage(msg);
}

if (typeof Worker !== 'undefined') {
  worker = createWorker();
}

// ── Public API ──

export function init(cells: [CellId, string][]): void {
  postToWorker({ t: 'INIT', cells });
}

export function apply(edits: Edit[], mode: Mode = currentMode): void {
  // Update raw mirror optimistically
  for (const edit of edits) {
    setRawMirror(edit.cell, edit.raw);
  }
  postToWorker({ t: 'APPLY', edits, mode });
}
