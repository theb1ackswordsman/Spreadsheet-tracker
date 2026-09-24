import { useSyncExternalStore } from 'react';
import type { CellId, Result, PatchCell, Stats } from '../engine/types';
import type { User } from '../shared/protocol';

// ── Types ──

export type Toast = {
  id: number;
  text: string;
  expires: number;
};

export type StoreMeta = {
  stats: Stats | null;
  version: number;
  renderCount: number;
  users: User[];
  connection: 'connected' | 'reconnecting';
  pendingCount: number;
  toasts: Toast[];
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

/** Presence keyed by cell: which users are on each cell */
const presenceByCell: Map<CellId, User[]> = new Map();

/** Per-cell presence subscribers */
const presenceSubs: Map<CellId, Set<() => void>> = new Map();

let meta: StoreMeta = {
  stats: null,
  version: 0,
  renderCount: 0,
  users: [],
  connection: 'reconnecting',
  pendingCount: 0,
  toasts: [],
};

const EMPTY: Result = Object.freeze({ v: null, e: null });

// ── Toast management ──

let nextToastId = 1;
const TOAST_DURATION = 4000;

export function addToast(text: string): void {
  const id = nextToastId++;
  const toast: Toast = { id, text, expires: Date.now() + TOAST_DURATION };
  meta = { ...meta, toasts: [...meta.toasts, toast] };
  notifyMeta();

  setTimeout(() => {
    removeToast(id);
  }, TOAST_DURATION);
}

function removeToast(id: number): void {
  const filtered = meta.toasts.filter(t => t.id !== id);
  if (filtered.length !== meta.toasts.length) {
    meta = { ...meta, toasts: filtered };
    notifyMeta();
  }
}

// ── Recent edits tracking for overwrite toast ──

const recentEdits: Map<CellId, number> = new Map(); // cell -> timestamp
const OVERWRITE_WINDOW = 10_000; // 10 seconds

export function markRecentEdit(cell: CellId): void {
  recentEdits.set(cell, Date.now());
}

export function wasRecentlyEdited(cell: CellId): boolean {
  const ts = recentEdits.get(cell);
  if (!ts) return false;
  return (Date.now() - ts) < OVERWRITE_WINDOW;
}

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
    notifyMeta();
  }
}

// ── Meta notification helper ──

function notifyMeta(): void {
  for (const cb of metaSubs) cb();
}

// ── Public API ──

export function applyPatch(cells: PatchCell[], stats: Stats): void {
  meta = { ...meta, stats, version: meta.version + 1, renderCount: devRenderCount };

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

/** Replace entire raw mirror (for SNAPSHOT). Clears old entries, notifies subscribers. */
export function replaceRawMirror(cells: [CellId, string][]): void {
  // Collect old keys to clear
  const oldKeys = new Set(rawMirror.keys());
  const newKeys = new Set<CellId>();
  for (const [id, raw] of cells) {
    newKeys.add(id);
    setRawMirror(id, raw);
  }
  // Clear entries that are no longer present
  for (const id of oldKeys) {
    if (!newKeys.has(id)) {
      setRawMirror(id, '');
    }
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

// ── Connection state ──

export function setConnection(state: 'connected' | 'reconnecting'): void {
  if (meta.connection === state) return;
  meta = { ...meta, connection: state };
  notifyMeta();
}

export function setPendingCount(count: number): void {
  if (meta.pendingCount === count) return;
  meta = { ...meta, pendingCount: count };
  notifyMeta();
}

// ── Users / Presence ──

export function setUsers(users: User[]): void {
  meta = { ...meta, users };
  // Rebuild presenceByCell
  const oldCells = new Set(presenceByCell.keys());
  presenceByCell.clear();
  for (const u of users) {
    if (u.cell) {
      let arr = presenceByCell.get(u.cell);
      if (!arr) {
        arr = [];
        presenceByCell.set(u.cell, arr);
      }
      arr.push(u);
    }
  }
  // Notify subscribers for changed cells
  const allCells = new Set([...oldCells, ...presenceByCell.keys()]);
  for (const cellId of allCells) {
    const cellPresenceSubs = presenceSubs.get(cellId);
    if (cellPresenceSubs) {
      for (const cb of cellPresenceSubs) cb();
    }
  }
  notifyMeta();
}

export function setServerVersion(v: number): void {
  meta = { ...meta, version: v };
}

const EMPTY_USERS: User[] = Object.freeze([] as unknown as User[]) as User[];

export function getPresenceForCell(id: CellId): User[] {
  return presenceByCell.get(id) ?? EMPTY_USERS;
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

export function subscribePresence(id: CellId, cb: () => void): () => void {
  let s = presenceSubs.get(id);
  if (!s) {
    s = new Set();
    presenceSubs.set(id, s);
  }
  s.add(cb);
  return () => {
    s!.delete(cb);
    if (s!.size === 0) presenceSubs.delete(id);
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

export function usePresence(id: CellId): User[] {
  return useSyncExternalStore(
    (cb) => subscribePresence(id, cb),
    () => getPresenceForCell(id),
  );
}

export function useMeta(): StoreMeta {
  return useSyncExternalStore(
    (cb) => subscribeMeta(cb),
    () => getMeta(),
  );
}
