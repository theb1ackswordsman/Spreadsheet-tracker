import type { CellId, Edit } from '../engine/types';

export type Role = 'owner' | 'editor' | 'viewer';
export type Op = { v: number; u: string; opId: number; edits: Edit[] };
export type User = { u: string; name: string; color: string; cell: CellId | null };
export type C2S =
  | { t: 'JOIN'; sheetId: string; name: string; cid: string }
  | { t: 'RESUME'; sheetId: string; name: string; lastVersion: number; cid: string }
  | { t: 'EDIT'; opId: number; edits: Edit[] }
  | { t: 'SELECT'; cell: CellId | null };
export type S2C =
  | { t: 'SNAPSHOT'; v: number; cells: [CellId, string][]; you: { u: string; name: string; color: string }; users: User[]; role: Role }
  | { t: 'OPS'; ops: Op[] }
  | { t: 'OP'; op: Op }
  | { t: 'PRESENCE'; users: User[] }
  | { t: 'ROLE'; role: Role }
  | { t: 'ERROR'; code: 'forbidden' | 'signin_required' | 'read_only' | 'bad_request'; msg: string };
