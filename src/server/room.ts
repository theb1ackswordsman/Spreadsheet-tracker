import type { WebSocket } from 'ws';
import type { CellId, Edit } from '../engine/types';
import type { C2S, S2C, Op, User, Role } from '../shared/protocol';
import { COLS, ROWS } from '../engine/constants';
import { randomUUID } from 'node:crypto';

// ── Palette ──

const PALETTE = [
  '#4285F4', '#EA4335', '#FBBC04', '#34A853',
  '#FF6D01', '#46BDC6', '#7B1FA2', '#C2185B',
];
let colorIdx = 0;

// ── Types ──

export interface Client {
  ws: WebSocket;
  u: string;
  name: string;
  color: string;
  cell: CellId | null;
  lastOpId: number;
  role?: Role;
}

interface Session {
  u: string;
  lastOpId: number;
  name: string;
  color: string;
  timer: ReturnType<typeof setTimeout> | null;
}

// ── Constants ──

const CELL_RE = /^[A-Z]{1,2}[0-9]{1,4}$/;
const MAX_RAW = 1000;
const MAX_EDITS = 5000;
const OP_LOG_SIZE = 5000;
const SESSION_TTL = 5 * 60 * 1000; // 5 minutes
const PRESENCE_THROTTLE = 50; // ms

// ── Room ──

export class Room {
  readonly sheetId: string;
  private version = 0;
  private readonly raw: Map<CellId, string> = new Map();
  private readonly opLog: Op[] = [];
  private opLogStart = 0; // version of the first entry in opLog ring
  private readonly clients: Map<string, Client> = new Map();
  private readonly sessions: Map<string, Session> = new Map(); // cid -> session
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceDirty = false;

  constructor(sheetId: string) {
    this.sheetId = sheetId;
  }

  /** Load persisted state (version + raw cells) */
  loadState(v: number, cells: [string, string][]): void {
    this.version = v;
    this.raw.clear();
    for (const [id, raw] of cells) {
      this.raw.set(id, raw);
    }
  }

  // ── Client management ──

  addClient(ws: WebSocket, name: string, cid: string | undefined): Client {
    const sanitized = sanitizeName(name);

    // Check for existing session by cid
    if (cid) {
      const session = this.sessions.get(cid);
      if (session) {
        // Reuse identity
        if (session.timer !== null) {
          clearTimeout(session.timer);
          session.timer = null;
        }
        const client: Client = {
          ws,
          u: session.u,
          name: session.name,
          color: session.color,
          cell: null,
          lastOpId: session.lastOpId,
        };
        this.clients.set(client.u, client);
        // Update session name in case it changed
        session.name = sanitized;
        return client;
      }
    }

    // New session
    const u = randomUUID();
    const color = PALETTE[colorIdx % PALETTE.length]!;
    colorIdx++;
    const client: Client = { ws, u, name: sanitized, color, cell: null, lastOpId: 0 };
    this.clients.set(u, client);

    // Store session
    if (cid) {
      this.sessions.set(cid, { u, lastOpId: 0, name: sanitized, color, timer: null });
    }

    return client;
  }

  removeClient(u: string, cid: string | undefined, ws?: WebSocket): void {
    const existing = this.clients.get(u);
    if (ws && existing && existing.ws !== ws) {
      // A new connection for this session already took over; do not remove it
      return;
    }
    this.clients.delete(u);
    // Schedule session expiry
    if (cid) {
      const session = this.sessions.get(cid);
      if (session) {
        session.timer = setTimeout(() => {
          this.sessions.delete(cid);
        }, SESSION_TTL);
      }
    }
    // Broadcast presence removal
    this.scheduleBroadcastPresence();
  }

  // ── Message handling ──

  handleMessage(client: Client, data: string): void {
    let msg: C2S;
    try {
      msg = JSON.parse(data) as C2S;
    } catch {
      this.sendTo(client, { t: 'ERROR', code: 'bad_request', msg: 'invalid JSON' });
      return;
    }

    switch (msg.t) {
      case 'JOIN':
        this.handleJoin(client);
        break;
      case 'RESUME':
        this.handleResume(client, msg.lastVersion);
        break;
      case 'EDIT':
        this.handleEdit(client, msg.opId, msg.edits);
        break;
      case 'SELECT':
        this.handleSelect(client, msg.cell);
        break;
      default:
        break;
    }
  }

  // ── JOIN ──

  private handleJoin(client: Client): void {
    this.sendSnapshot(client);
    this.scheduleBroadcastPresence();
  }

  // ── RESUME ──

  private handleResume(client: Client, lastVersion: number): void {
    // Server restarted or client ahead: send SNAPSHOT
    if (lastVersion > this.version) {
      this.sendSnapshot(client);
      this.scheduleBroadcastPresence();
      return;
    }

    // Already caught up
    if (lastVersion === this.version) {
      this.sendTo(client, { t: 'OPS', ops: [] });
      this.scheduleBroadcastPresence();
      return;
    }

    // Need versions lastVersion+1 through this.version.
    // opLog contains ops starting at version this.opLogStart.
    // We can serve delta only if the log covers EVERY required version.
    const neededFrom = lastVersion + 1;
    if (this.opLog.length > 0 && this.opLogStart <= neededFrom) {
      const startIdx = neededFrom - this.opLogStart;
      if (startIdx >= 0 && startIdx < this.opLog.length) {
        const ops = this.opLog.slice(startIdx);
        // Verify contiguous coverage
        if (ops.length === this.version - lastVersion && ops[0]!.v === neededFrom) {
          this.sendTo(client, { t: 'OPS', ops });
          this.scheduleBroadcastPresence();
          return;
        }
      }
    }

    // Otherwise full snapshot
    this.sendSnapshot(client);
    this.scheduleBroadcastPresence();
  }

  // ── SELECT ──

  private handleSelect(client: Client, cell: CellId | null): void {
    client.cell = cell;
    this.scheduleBroadcastPresence();
  }

  // ── Throttled presence broadcast ──

  private scheduleBroadcastPresence(): void {
    this.presenceDirty = true;
    if (this.presenceTimer !== null) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      if (!this.presenceDirty) return;
      this.presenceDirty = false;
      this.broadcastPresence();
    }, PRESENCE_THROTTLE);
  }

  private broadcastPresence(): void {
    const users = this.getUserList();
    const msg: S2C = { t: 'PRESENCE', users };
    for (const c of this.clients.values()) {
      this.sendTo(c, msg);
    }
  }

  // ── EDIT ──

  handleEdit(client: Client, opId: number, edits: Edit[]): void {
    // opId dedupe
    if (opId <= client.lastOpId) {
      return;
    }

    // Validate
    const err = validateEdits(edits);
    if (err !== null) {
      this.sendTo(client, { t: 'ERROR', code: 'bad_request', msg: err });
      return;
    }

    client.lastOpId = opId;
    this.version++;

    // Update session lastOpId
    for (const [, session] of this.sessions) {
      if (session.u === client.u) {
        session.lastOpId = opId;
        break;
      }
    }

    // Apply to raw map
    for (const edit of edits) {
      if (edit.raw === '') {
        this.raw.delete(edit.cell);
      } else {
        this.raw.set(edit.cell, edit.raw);
      }
    }

    // Build op
    const op: Op = { v: this.version, u: client.u, opId, edits };

    // Push to ring buffer
    this.opLog.push(op);
    if (this.opLog.length > OP_LOG_SIZE) {
      this.opLog.shift();
      this.opLogStart++;
    }
    if (this.opLogStart === 0 && this.opLog.length === 1) {
      this.opLogStart = this.version;
    }

    // Broadcast to ALL clients including sender
    const msg: S2C = { t: 'OP', op };
    for (const c of this.clients.values()) {
      this.sendTo(c, msg);
    }
  }

  // ── Snapshot ──

  private sendSnapshot(client: Client): void {
    const cells: [CellId, string][] = [];
    for (const [id, raw] of this.raw) {
      cells.push([id, raw]);
    }
    const users = this.getUserList();
    this.sendTo(client, {
      t: 'SNAPSHOT',
      v: this.version,
      cells,
      you: { u: client.u, name: client.name, color: client.color },
      users,
      role: client.role ?? 'editor',
    });
  }

  // ── Send ──

  private sendTo(client: Client, msg: S2C): void {
    if (client.ws.readyState === 1) { // WebSocket.OPEN
      client.ws.send(JSON.stringify(msg));
    }
  }

  // ── Helpers ──

  private getUserList(): User[] {
    const users: User[] = [];
    for (const c of this.clients.values()) {
      users.push({ u: c.u, name: c.name, color: c.color, cell: c.cell });
    }
    return users;
  }

  // ── Accessors for testing ──

  getVersion(): number { return this.version; }
  getRaw(): Map<CellId, string> { return this.raw; }
  getClientCount(): number { return this.clients.size; }
  getSessionCount(): number { return this.sessions.size; }
  getUserList_test(): User[] { return this.getUserList(); }
}

// ── Validation ──

export function validateEdits(edits: Edit[]): string | null {
  if (!Array.isArray(edits)) return 'edits must be an array';
  if (edits.length > MAX_EDITS) return `too many edits (max ${MAX_EDITS})`;
  for (const edit of edits) {
    if (!CELL_RE.test(edit.cell)) return `invalid cell id: ${edit.cell}`;
    if (!isCellInBounds(edit.cell)) return `cell out of bounds: ${edit.cell}`;
    if (typeof edit.raw !== 'string') return 'raw must be a string';
    if (edit.raw.length > MAX_RAW) return `raw too long (max ${MAX_RAW} chars)`;
  }
  return null;
}

function isCellInBounds(cell: CellId): boolean {
  let col = 0;
  let i = 0;
  while (i < cell.length && cell[i]! >= 'A' && cell[i]! <= 'Z') {
    col = col * 26 + (cell.charCodeAt(i) - 64);
    i++;
  }
  const row = parseInt(cell.slice(i), 10);
  return col >= 1 && col <= COLS && row >= 1 && row <= ROWS;
}

function sanitizeName(name: string): string {
  const stripped = String(name).replace(/[\x00-\x1f\x7f]/g, '');
  const trimmed = stripped.trim().slice(0, 24);
  return trimmed || 'Guest';
}

// ── Room registry ──

const rooms: Map<string, Room> = new Map();

export function getRoom(sheetId: string): Room {
  let room = rooms.get(sheetId);
  if (!room) {
    room = new Room(sheetId);
    rooms.set(sheetId, room);
  }
  return room;
}
