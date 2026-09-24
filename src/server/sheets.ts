import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { SessionUser } from './auth';
import { Room } from './room';
import type { CellId } from '../engine/types';

export type Role = 'owner' | 'editor' | 'viewer';

export interface SheetMeta {
  id: string;
  title: string;
  owner: string; // lowercase verified email
  visibility: 'restricted' | 'public';
  publicRole: 'viewer' | 'editor';
  acl: [string, 'editor' | 'viewer'][]; // [lowercase email, role][]
  createdAt: number;
  updatedAt: number;
}

export interface SheetData {
  meta: SheetMeta;
  v: number;
  cells: [CellId, string][];
}

// ── Validation Helpers ──

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

export function validateAcl(acl: unknown): [string, 'editor' | 'viewer'][] | null {
  if (!Array.isArray(acl)) return null;
  if (acl.length > 100) return null;
  const validated: [string, 'editor' | 'viewer'][] = [];
  const seen = new Set<string>();
  for (const entry of acl) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [email, role] = entry;
    if (!isValidEmail(email)) return null;
    if (role !== 'editor' && role !== 'viewer') return null;
    const lower = email.toLowerCase().trim();
    if (seen.has(lower)) return null;
    seen.add(lower);
    validated.push([lower, role]);
  }
  return validated;
}

export function sanitizeTitle(title: unknown): string {
  if (typeof title !== 'string') return 'Untitled sheet';
  const cleaned = title.replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (!cleaned) return 'Untitled sheet';
  return cleaned.slice(0, 100);
}

// ── Role Determination ──

export function roleFor(meta: SheetMeta, user: SessionUser | null): Role | null {
  // If user is owner
  if (user && user.email.toLowerCase() === meta.owner.toLowerCase()) {
    return 'owner';
  }

  // Find ACL role for user if user is signed in
  let aclRole: 'editor' | 'viewer' | null = null;
  if (user) {
    const userEmail = user.email.toLowerCase();
    for (const [email, role] of meta.acl) {
      if (email.toLowerCase() === userEmail) {
        aclRole = role;
        break;
      }
    }
  }

  // Find public role if visibility is public
  const publicRole: 'editor' | 'viewer' | null =
    meta.visibility === 'public' ? meta.publicRole : null;

  // Highest wins: 'owner' > 'editor' > 'viewer'
  if (aclRole === 'editor' || publicRole === 'editor') {
    return 'editor';
  }
  if (aclRole === 'viewer' || publicRole === 'viewer') {
    return 'viewer';
  }

  return null;
}

// ── Sheet Manager ──

export class SheetManager {
  readonly sheetsDir: string;
  readonly persist: boolean;
  private readonly emailIndex = new Map<string, Set<string>>(); // email -> Set<sheetId>
  private readonly metas = new Map<string, SheetMeta>(); // sheetId -> SheetMeta
  private readonly rooms = new Map<string, Room>(); // sheetId -> Room
  private readonly evictionTimers = new Map<string, NodeJS.Timeout>();
  private readonly persistTimer: NodeJS.Timeout | null = null;

  constructor(dataDir: string, persist = true) {
    this.sheetsDir = path.join(dataDir, 'sheets');
    this.persist = persist;

    if (persist) {
      try {
        if (!fs.existsSync(this.sheetsDir)) {
          fs.mkdirSync(this.sheetsDir, { recursive: true });
        }
      } catch {}
      this.scanIndex();
      this.persistTimer = setInterval(() => {
        this.saveDirtyRooms();
      }, 5000);
      this.persistTimer.unref?.();
    }
  }

  private scanIndex(): void {
    try {
      if (!fs.existsSync(this.sheetsDir)) return;
      const files = fs.readdirSync(this.sheetsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const sheetPath = path.join(this.sheetsDir, file);
        try {
          const raw = fs.readFileSync(sheetPath, 'utf8');
          const data = JSON.parse(raw) as SheetData;
          if (data && data.meta && data.meta.id) {
            this.metas.set(data.meta.id, data.meta);
            this.addSheetToIndex(data.meta);
          }
        } catch {}
      }
    } catch {}
  }

  private addSheetToIndex(meta: SheetMeta): void {
    const ownerEmail = meta.owner.toLowerCase();
    if (!this.emailIndex.has(ownerEmail)) {
      this.emailIndex.set(ownerEmail, new Set());
    }
    this.emailIndex.get(ownerEmail)!.add(meta.id);

    for (const [email] of meta.acl) {
      const lower = email.toLowerCase();
      if (!this.emailIndex.has(lower)) {
        this.emailIndex.set(lower, new Set());
      }
      this.emailIndex.get(lower)!.add(meta.id);
    }
  }

  private removeSheetFromIndex(sheetId: string): void {
    for (const set of this.emailIndex.values()) {
      set.delete(sheetId);
    }
  }

  createSheet(ownerEmail: string): SheetMeta {
    const id = crypto.randomBytes(16).toString('base64url');
    const now = Date.now();
    const meta: SheetMeta = {
      id,
      title: 'Untitled sheet',
      owner: ownerEmail.toLowerCase().trim(),
      visibility: 'restricted',
      publicRole: 'viewer',
      acl: [],
      createdAt: now,
      updatedAt: now,
    };

    this.metas.set(id, meta);
    this.addSheetToIndex(meta);

    if (this.persist) {
      this.writeSheetToDisk(id, meta, 0, []);
    }

    return meta;
  }

  getSheetMeta(id: string): SheetMeta | null {
    const inMem = this.metas.get(id);
    if (inMem) return inMem;

    // Check disk
    if (this.persist) {
      const sheetPath = path.join(this.sheetsDir, `${id}.json`);
      if (fs.existsSync(sheetPath)) {
        try {
          const raw = fs.readFileSync(sheetPath, 'utf8');
          const data = JSON.parse(raw) as SheetData;
          if (data && data.meta) {
            this.metas.set(id, data.meta);
            this.addSheetToIndex(data.meta);
            return data.meta;
          }
        } catch {}
      }
    }
    return null;
  }

  getRecentSheets(userEmail: string): { id: string; title: string; role: Role; updatedAt: number }[] {
    const email = userEmail.toLowerCase();
    const sheetIds = this.emailIndex.get(email);
    if (!sheetIds || sheetIds.size === 0) return [];

    const user: SessionUser = { email, name: '' };
    const list: { id: string; title: string; role: Role; updatedAt: number }[] = [];

    for (const id of sheetIds) {
      const meta = this.getSheetMeta(id);
      if (meta) {
        const role = roleFor(meta, user);
        if (role !== null) {
          list.push({
            id: meta.id,
            title: meta.title,
            role,
            updatedAt: meta.updatedAt,
          });
        }
      }
    }

    // Sort by updatedAt descending
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    return list.slice(0, 20);
  }

  updateTitle(sheetId: string, titleRaw: unknown): { ok: boolean; title?: string; error?: string } {
    const meta = this.getSheetMeta(sheetId);
    if (!meta) return { ok: false, error: 'not_found' };

    meta.title = sanitizeTitle(titleRaw);
    meta.updatedAt = Date.now();
    this.metas.set(sheetId, meta);

    const room = this.rooms.get(sheetId);
    if (room) {
      room.setMeta(meta);
    }

    if (this.persist) {
      this.flushSheet(sheetId);
    }

    return { ok: true, title: meta.title };
  }

  updateShare(
    sheetId: string,
    visibility: 'restricted' | 'public',
    publicRole: 'viewer' | 'editor',
    acl: [string, 'editor' | 'viewer'][]
  ): { ok: boolean; error?: string } {
    const meta = this.getSheetMeta(sheetId);
    if (!meta) return { ok: false, error: 'not_found' };

    meta.visibility = visibility;
    meta.publicRole = publicRole;
    meta.acl = acl;
    meta.updatedAt = Date.now();
    this.metas.set(sheetId, meta);

    // Rebuild index for this sheet
    this.removeSheetFromIndex(sheetId);
    this.addSheetToIndex(meta);

    // Update active room and propagate role changes to connected clients
    const room = this.rooms.get(sheetId);
    if (room) {
      room.setMeta(meta);
      room.updateRoles((user) => roleFor(meta, user));
    }

    if (this.persist) {
      this.flushSheet(sheetId);
    }

    return { ok: true };
  }

  getOrCreateRoom(sheetId: string): Room | null {
    // Check if room is already active in memory
    const existing = this.rooms.get(sheetId);
    if (existing) {
      // Cancel eviction timer if any
      const timer = this.evictionTimers.get(sheetId);
      if (timer) {
        clearTimeout(timer);
        this.evictionTimers.delete(sheetId);
      }
      return existing;
    }

    // Must exist in meta or on disk
    const meta = this.getSheetMeta(sheetId);
    if (!meta) return null;

    let v = 0;
    let cells: [string, string][] = [];

    if (this.persist) {
      const sheetPath = path.join(this.sheetsDir, `${sheetId}.json`);
      if (fs.existsSync(sheetPath)) {
        try {
          const raw = fs.readFileSync(sheetPath, 'utf8');
          const data = JSON.parse(raw) as SheetData;
          v = data.v ?? 0;
          cells = data.cells ?? [];
        } catch {}
      }
    }

    const room = new Room(sheetId);
    room.setMeta(meta);
    room.loadState(v, cells);
    this.rooms.set(sheetId, room);

    return room;
  }

  onClientLeaveRoom(sheetId: string): void {
    const room = this.rooms.get(sheetId);
    if (!room) return;

    if (room.getClientCount() === 0) {
      // Set eviction timer for 10 minutes
      if (this.evictionTimers.has(sheetId)) {
        clearTimeout(this.evictionTimers.get(sheetId)!);
      }
      const timer = setTimeout(() => {
        this.evictRoom(sheetId);
      }, 10 * 60 * 1000);
      timer.unref?.();
      this.evictionTimers.set(sheetId, timer);
    }
  }

  private evictRoom(sheetId: string): void {
    const room = this.rooms.get(sheetId);
    if (!room) return;
    if (room.getClientCount() > 0) return; // Client reconnected

    // Flush first
    if (this.persist) {
      this.flushRoom(room);
    }
    this.rooms.delete(sheetId);
    this.evictionTimers.delete(sheetId);
  }

  private flushSheet(sheetId: string): void {
    const meta = this.metas.get(sheetId);
    if (!meta) return;
    const room = this.rooms.get(sheetId);
    if (room) {
      this.flushRoom(room);
    } else {
      // Just write meta with empty or existing cells
      this.writeSheetToDisk(sheetId, meta, 0, []);
    }
  }

  private flushRoom(room: Room): void {
    const meta = room.getMeta() ?? this.metas.get(room.sheetId);
    if (!meta) return;
    const entries: [CellId, string][] = [];
    for (const [id, raw] of room.getRaw()) {
      entries.push([id, raw]);
    }
    this.writeSheetToDisk(room.sheetId, meta, room.getVersion(), entries);
    room.markClean();
  }

  private saveDirtyRooms(): void {
    if (!this.persist) return;
    for (const room of this.rooms.values()) {
      if (room.isDirty()) {
        this.flushRoom(room);
      }
    }
  }

  private writeSheetToDisk(
    sheetId: string,
    meta: SheetMeta,
    v: number,
    cells: [CellId, string][]
  ): void {
    try {
      if (!fs.existsSync(this.sheetsDir)) {
        fs.mkdirSync(this.sheetsDir, { recursive: true });
      }
      const data: SheetData = { meta, v, cells };
      const filePath = path.join(this.sheetsDir, `${sheetId}.json`);
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch {}
  }

  saveAll(): void {
    if (!this.persist) return;
    for (const room of this.rooms.values()) {
      this.flushRoom(room);
    }
  }

  destroy(): void {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
    }
    for (const timer of this.evictionTimers.values()) {
      clearTimeout(timer);
    }
    this.evictionTimers.clear();
    this.saveAll();
  }
}
