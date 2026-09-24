import type { CellId, Edit } from '../engine/types';
export type Op = { v: number; u: string; opId: number; edits: Edit[] };
export type User = { u: string; name: string; color: string; cell: CellId | null };
export type C2S =
  | { t: 'JOIN'; sheetId: string; name: string }
  | { t: 'RESUME'; sheetId: string; name: string; lastVersion: number }
  | { t: 'EDIT'; opId: number; edits: Edit[] }
  | { t: 'SELECT'; cell: CellId | null };
export type S2C =
  | { t: 'SNAPSHOT'; v: number; cells: [CellId, string][]; you: { u: string; name: string; color: string }; users: User[] }
  | { t: 'OPS'; ops: Op[] }
  | { t: 'OP'; op: Op }
  | { t: 'PRESENCE'; users: User[] }
  | { t: 'ERROR'; msg: string };
