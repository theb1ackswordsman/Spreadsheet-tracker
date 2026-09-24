import type { CellId } from '../engine/types';

/**
 * FNV-1a 32-bit hash. Returns hex string.
 */
export function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Compute FNV-1a hash over sorted lines "id=raw" of a cells map, joined with "\n".
 */
export function cellsHash(cells: Map<CellId, string>): string {
  const lines: string[] = [];
  for (const [id, raw] of cells) {
    lines.push(`${id}=${raw}`);
  }
  lines.sort();
  return fnv1a32(lines.join('\n'));
}
