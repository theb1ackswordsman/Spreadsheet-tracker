import type { C2S, S2C, Op, User } from '../shared/protocol';
import type { CellId, Edit } from '../engine/types';
import { init as bridgeInit, apply as bridgeApply } from './bridge';
import {
  replaceRawMirror, setConnection, setPendingCount, setUsers,
  setServerVersion, addToast, markRecentEdit, wasRecentlyEdited,
  recordRtt, getEvalMode,
} from './store';

// ── State ──

let ws: WebSocket | null = null;
let connected = false;
let myU: string | null = null;
let myName: string | null = null;
let lastServerVersion = 0;
let backoff = 250;
const MAX_BACKOFF = 5000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Pending ops awaiting echo
const pending: Map<number, Edit[]> = new Map();
const editTimestamps: Map<number, number> = new Map();
let nextOpId = 1;

// Client tab id – 128-bit random, generated once per tab, kept in memory
const cid = crypto.randomUUID();

// Current selection (for sending SELECT)
let currentSelection: CellId | null = null;

// User list cache for name lookups
let usersByU: Map<string, User> = new Map();

// ── Random name ──

const NAMES = [
  'Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Heidi',
  'Ivan', 'Judy', 'Karl', 'Lena', 'Mallory', 'Nina', 'Oscar', 'Peggy',
];

function randomName(): string {
  const idx = Math.floor(Math.random() * NAMES.length);
  return NAMES[idx]!;
}

const userName = randomName();

// ── Connect ──

function getUrl(): string {
  if (typeof location === 'undefined') return 'ws://localhost:8787/ws';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function connect(): void {
  if (ws) return;
  const url = getUrl();
  ws = new WebSocket(url);

  ws.onopen = () => {
    connected = true;
    backoff = 250;
    setConnection('connected');

    // JOIN or RESUME
    if (lastServerVersion > 0) {
      send({ t: 'RESUME', sheetId: 'main', name: userName, lastVersion: lastServerVersion, cid });
    } else {
      send({ t: 'JOIN', sheetId: 'main', name: userName, cid });
    }
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data as string) as S2C;
    handleMessage(msg);
  };

  ws.onclose = () => {
    ws = null;
    connected = false;
    setConnection('reconnecting');
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after onerror
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, backoff);
  backoff = Math.min(backoff * 2, MAX_BACKOFF);
}

// ── Message handling ──

function handleMessage(msg: S2C): void {
  switch (msg.t) {
    case 'SNAPSHOT':
      myU = msg.you.u;
      myName = msg.you.name;
      lastServerVersion = msg.v;
      setServerVersion(msg.v);
      // Clear pending since we're getting a full snapshot
      pending.clear();
      setPendingCount(0);
      // Replace store raw mirror and reinit worker
      replaceRawMirror(msg.cells);
      bridgeInit(msg.cells);
      // Set users
      setUsers(msg.users);
      buildUserMap(msg.users);
      // Resend pending edits after snapshot (reconnect case)
      resendPending();
      // Resend selection
      if (currentSelection !== null) {
        send({ t: 'SELECT', cell: currentSelection });
      }
      break;
    case 'OP':
      applyOp(msg.op);
      break;
    case 'OPS':
      // Apply in order (they should already be sorted)
      for (const op of msg.ops) {
        applyOp(op);
      }
      // Resend pending edits after OPS (reconnect case)
      resendPending();
      // Resend selection
      if (currentSelection !== null) {
        send({ t: 'SELECT', cell: currentSelection });
      }
      break;
    case 'PRESENCE':
      setUsers(msg.users);
      buildUserMap(msg.users);
      break;
    case 'ERROR':
      console.warn('[socket] server error:', msg.msg);
      break;
    default:
      break;
  }
}

function buildUserMap(users: User[]): void {
  usersByU = new Map();
  for (const u of users) {
    usersByU.set(u.u, u);
  }
}

function applyOp(op: Op): void {
  // Ensure we apply in version order
  if (op.v <= lastServerVersion) return;
  lastServerVersion = op.v;
  setServerVersion(op.v);

  // Check for overwrite toast before applying
  if (op.u !== myU) {
    for (const edit of op.edits) {
      if (wasRecentlyEdited(edit.cell)) {
        const remoteUser = usersByU.get(op.u);
        const remoteName = remoteUser ? remoteUser.name : 'Someone';
        addToast(`${remoteName} changed ${edit.cell} after your edit`);
      }
    }
  }

  // If this is the echo of our own op, clear from pending
  if (op.u === myU) {
    pending.delete(op.opId);
    setPendingCount(pending.size);
    const sentAt = editTimestamps.get(op.opId);
    if (sentAt !== undefined) {
      editTimestamps.delete(op.opId);
      recordRtt(performance.now() - sentAt);
    }
  }

  // Apply edits through bridge (which updates raw mirror + worker)
  // Idempotent: setRawMirror is no-op if raw unchanged (own echo)
  bridgeApply(op.edits, getEvalMode());
}

function resendPending(): void {
  for (const [opId, edits] of pending) {
    editTimestamps.set(opId, performance.now());
    send({ t: 'EDIT', opId, edits });
  }
}

// ── Send ──

function send(msg: C2S): void {
  if (ws && connected) {
    ws.send(JSON.stringify(msg));
  }
}

// ── Public API ──

/** Called by commit.ts to send an edit to the server */
export function sendEdit(edits: Edit[]): void {
  const opId = nextOpId++;
  pending.set(opId, edits);
  setPendingCount(pending.size);
  editTimestamps.set(opId, performance.now());
  // Mark cells as recently edited for overwrite toast
  for (const edit of edits) {
    markRecentEdit(edit.cell);
  }
  send({ t: 'EDIT', opId, edits });
}

/** Send SELECT to server on selection change */
export function sendSelect(cell: CellId | null): void {
  currentSelection = cell;
  send({ t: 'SELECT', cell });
}

/** Whether we're connected */
export function isConnected(): boolean {
  return connected;
}

/** Get current user id */
export function getMyU(): string | null {
  return myU;
}

/** Drop connection for debug */
export function dropConnection(): void {
  if (ws) {
    ws.close();
  }
}

// ── Auto-connect on module load (browser only) ──
if (typeof window !== 'undefined' && typeof WebSocket !== 'undefined') {
  connect();
}
