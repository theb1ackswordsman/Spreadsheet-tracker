import { useSyncExternalStore } from 'react';
import type { CellId, Result, PatchCell, Stats } from '../engine/types';

// ── Types ──

export type StoreMeta = {
  stats: Stats | null;
  version: number;
  renderCount: number;
};

// ── Dev render counter (set from Cell.tsx) ──
let devRenderCount = 0;

export function bumpRenderCount(): void {
  devRenderCount++;
}

export function getDevRenderCount(): number {
  return devRenderCount;
}

export function resetDevRenderCount(): void {
  devRenderCount = 0;
}

// ── State ──

/** Raw formula strings mirror (kept in sync with worker) */
const rawMirror: Map<CellId, string> = new Map();

/** Immutable Result per cell; replaced only when value/error actually changes */
const values: Map<CellId, Result> = new Map();

/** Per-cell subscriber sets */
const subs: Map<CellId, Set<() => void>> = new Map();

/** Meta subscribers */
const metaSubs: Set<() => void> = new Set();

let meta: StoreMeta = { stats: null, version: 0, renderCount: 0 };

const EMPTY: Result = Object.freeze({ v: null, e: null });

// ── Pending PATCH buffer (batched per animation frame) ──

let pendingPatch: PatchCell[] | null = null;
let rafId = 0;

function flushPatch(): void {
  rafId = 0;
  const cells = pendingPatch;
  if (!cells) return;
  pendingPatch = null;

  let metaChanged = false;

  for (const [id, v, e] of cells) {
    const prev = values.get(id);
    // Replace only on actual change
    if (prev && prev.v === v && prev.e === e) continue;

    if (v === null && e === null) {
      values.delete(id);
    } else {
      values.set(id, Object.freeze({ v, e }));
    }
    metaChanged = true;

    const cellSubs = subs.get(id);
    if (cellSubs) {
      for (const cb of cellSubs) cb();
    }
  }

  if (metaChanged) {
    for (const cb of metaSubs) cb();
  }
}

// ── Public API ──

export function applyPatch(cells: PatchCell[], stats: Stats): void {
  meta = { stats, version: meta.version + 1, renderCount: devRenderCount };

  if (!pendingPatch) {
    pendingPatch = cells;
    if (typeof requestAnimationFrame !== 'undefined') {
      rafId = requestAnimationFrame(flushPatch);
    } else {
      // Node/test environment: flush synchronously
      flushPatch();
    }
  } else {
    // Merge into existing pending batch
    pendingPatch = pendingPatch.concat(cells);
  }
}

export function setRawMirror(id: CellId, raw: string): void {
  const prev = rawMirror.get(id) ?? '';
  if (prev === raw) return;
  if (raw === '') {
    rawMirror.delete(id);
  } else {
    rawMirror.set(id, raw);
  }
  const cellSubs = subs.get(id);
  if (cellSubs) {
    for (const cb of cellSubs) cb();
  }
}

export function getRaw(id: CellId): string {
  return rawMirror.get(id) ?? '';
}

export function getCell(id: CellId): Result {
  return values.get(id) ?? EMPTY;
}

export function getMeta(): StoreMeta {
  return meta;
}

// ── Subscriptions ──

export function subscribeCell(id: CellId, cb: () => void): () => void {
  let s = subs.get(id);
  if (!s) {
    s = new Set();
    subs.set(id, s);
  }
  s.add(cb);
  return () => {
    s!.delete(cb);
    if (s!.size === 0) subs.delete(id);
  };
}

export function subscribeMeta(cb: () => void): () => void {
  metaSubs.add(cb);
  return () => { metaSubs.delete(cb); };
}

// ── React hooks ──

export function useCell(id: CellId): Result {
  return useSyncExternalStore(
    (cb) => subscribeCell(id, cb),
    () => getCell(id),
  );
}

export function useRaw(id: CellId): string {
  return useSyncExternalStore(
    (cb) => subscribeCell(id, cb),
    () => getRaw(id),
  );
}
