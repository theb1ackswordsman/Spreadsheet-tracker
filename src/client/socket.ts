import type { C2S, S2C, Op } from '../shared/protocol';
import type { Edit } from '../engine/types';
import { init as bridgeInit, apply as bridgeApply } from './bridge';
import { replaceRawMirror } from './store';

// ── State ──

let ws: WebSocket | null = null;
let connected = false;
let myU: string | null = null;
let lastServerVersion = 0;
let backoff = 250;
const MAX_BACKOFF = 5000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Pending ops awaiting echo
const pending: Map<number, Edit[]> = new Map();
let nextOpId = 1;

// ── Connect ──

function getUrl(): string {
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
    // JOIN or RESUME
    if (lastServerVersion > 0) {
      send({ t: 'RESUME', sheetId: 'main', name: 'User', lastVersion: lastServerVersion });
      // Resend pending edits
      for (const [opId, edits] of pending) {
        send({ t: 'EDIT', opId, edits });
      }
    } else {
      send({ t: 'JOIN', sheetId: 'main', name: 'User' });
    }
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data as string) as S2C;
    handleMessage(msg);
  };

  ws.onclose = () => {
    ws = null;
    connected = false;
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
      lastServerVersion = msg.v;
      // Clear pending since we're getting a full snapshot
      pending.clear();
      // Replace store raw mirror and reinit worker
      replaceRawMirror(msg.cells);
      bridgeInit(msg.cells);
      break;
    case 'OP':
      applyOp(msg.op);
      break;
    case 'OPS':
      // Apply in order (they should already be sorted)
      for (const op of msg.ops) {
        applyOp(op);
      }
      break;
    case 'ERROR':
      console.warn('[socket] server error:', msg.msg);
      break;
    default:
      break;
  }
}

function applyOp(op: Op): void {
  // Ensure we apply in version order
  if (op.v <= lastServerVersion) return;
  lastServerVersion = op.v;

  // If this is the echo of our own op, clear from pending
  if (op.u === myU) {
    pending.delete(op.opId);
  }

  // Apply edits through bridge (which updates raw mirror + worker)
  // Idempotent: setRawMirror is no-op if raw unchanged (own echo)
  bridgeApply(op.edits);
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
  send({ t: 'EDIT', opId, edits });
}

/** Whether we're connected */
export function isConnected(): boolean {
  return connected;
}

// ── Auto-connect on module load ──
connect();
