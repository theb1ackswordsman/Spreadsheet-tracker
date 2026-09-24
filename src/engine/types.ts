export type CellId = string; // "A1".."Z1000"
export type ErrCode = '#REF!' | '#DIV/0!' | '#VALUE!' | '#NAME?' | '#CIRCULAR!';
export type Value = number | string | null;
export type Result = { v: Value; e: ErrCode | null };
export type Edit = { cell: CellId; raw: string }; // raw '' = clear
export type Mode = 'inc' | 'naive';
export type PatchCell = [CellId, Value, ErrCode | null];
export type Stats = { scope: number; populated: number; ms: number; mode: Mode };
export type ToWorker = { t: 'INIT'; cells: [CellId, string][] } | { t: 'APPLY'; edits: Edit[]; mode: Mode };
export type FromWorker = { t: 'PATCH'; cells: PatchCell[]; stats: Stats };
