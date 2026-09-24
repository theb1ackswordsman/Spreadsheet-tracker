import type { WebSocket } from 'ws';
import type { CellId, Edit } from '../engine/types';
import type { C2S, S2C, Op, User } from '../shared/protocol';
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
}

// ── Constants ──

const CELL_RE = /^[A-Z]{1,2}[0-9]{1,4}$/;
const MAX_RAW = 1000;
const MAX_EDITS = 5000;
const OP_LOG_SIZE = 5000;

// ── Room ──

export class Room {
  readonly sheetId: string;
  private version = 0;
  private readonly raw: Map<CellId, string> = new Map();
  private readonly opLog: Op[] = [];
  private opLogStart = 0; // version of the first entry in opLog ring
  private readonly clients: Map<string, Client> = new Map();

  constructor(sheetId: string) {
    this.sheetId = sheetId;
  }

  // ── Client management ──

  addClient(ws: WebSocket, name: string): Client {
    const u = randomUUID();
    const sanitized = sanitizeName(name);
    const color = PALETTE[colorIdx % PALETTE.length]!;
    colorIdx++;
    const client: Client = { ws, u, name: sanitized, color, cell: null, lastOpId: 0 };
    this.clients.set(u, client);
    return client;
  }

  removeClient(u: string): void {
    this.clients.delete(u);
  }

  // ── Message handling ──

  handleMessage(client: Client, data: string): void {
    let msg: C2S;
    try {
      msg = JSON.parse(data) as C2S;
    } catch {
      this.sendTo(client, { t: 'ERROR', msg: 'invalid JSON' });
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
      // SELECT is a later phase (presence)
      default:
        break;
    }
  }

  // ── JOIN ──

  private handleJoin(client: Client): void {
    this.sendSnapshot(client);
  }

  // ── RESUME ──

  private handleResume(client: Client, lastVersion: number): void {
    const oldestV = this.opLogStart;
    if (lastVersion >= oldestV - 1 && lastVersion < this.version) {
      // Can send incremental OPS
      const startIdx = lastVersion - this.opLogStart;
      const ops = this.opLog.slice(Math.max(0, startIdx));
      // Filter only ops after lastVersion
      const filtered = ops.filter(op => op.v > lastVersion);
      if (filtered.length > 0) {
        this.sendTo(client, { t: 'OPS', ops: filtered });
        return;
      }
    }
    if (lastVersion >= this.version) {
      // Client is up to date, just send snapshot anyway (simplest)
      // Actually if equal, they're caught up—send empty OPS or just snapshot
      if (lastVersion === this.version) {
        this.sendTo(client, { t: 'OPS', ops: [] });
        return;
      }
    }
    // Otherwise full snapshot
    this.sendSnapshot(client);
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
      this.sendTo(client, { t: 'ERROR', msg: err });
      return;
    }

    client.lastOpId = opId;
    this.version++;

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
    const users: User[] = [];
    for (const c of this.clients.values()) {
      users.push({ u: c.u, name: c.name, color: c.color, cell: c.cell });
    }
    this.sendTo(client, {
      t: 'SNAPSHOT',
      v: this.version,
      cells,
      you: { u: client.u, name: client.name, color: client.color },
      users,
    });
  }

  // ── Send ──

  private sendTo(client: Client, msg: S2C): void {
    if (client.ws.readyState === 1) { // WebSocket.OPEN
      client.ws.send(JSON.stringify(msg));
    }
  }

  // ── Accessors for testing ──

  getVersion(): number { return this.version; }
  getRaw(): Map<CellId, string> { return this.raw; }
  getClientCount(): number { return this.clients.size; }
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
  // Parse column letters and row number
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
  const trimmed = String(name).trim().slice(0, 24);
  return trimmed || 'Anon';
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
