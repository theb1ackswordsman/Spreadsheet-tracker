import { describe, it, expect } from 'vitest';
import { Room, validateEdits } from './room';
import type { Edit } from '../engine/types';

describe('server validation', () => {
  // ── validateEdits ──

  it('rejects invalid cell ids', () => {
    expect(validateEdits([{ cell: 'a1', raw: 'x' }])).toMatch(/invalid cell/);
    expect(validateEdits([{ cell: '1A', raw: 'x' }])).toMatch(/invalid cell/);
    expect(validateEdits([{ cell: '', raw: 'x' }])).toMatch(/invalid cell/);
    expect(validateEdits([{ cell: 'A', raw: 'x' }])).toMatch(/invalid cell/);
    expect(validateEdits([{ cell: 'A0', raw: 'x' }])).toMatch(/cell out of bounds/);
    expect(validateEdits([{ cell: 'AA1', raw: 'x' }])).toMatch(/cell out of bounds/);
  });

  it('accepts valid cell ids', () => {
    expect(validateEdits([{ cell: 'A1', raw: 'hi' }])).toBeNull();
    expect(validateEdits([{ cell: 'Z1000', raw: '' }])).toBeNull();
    expect(validateEdits([{ cell: 'Z1', raw: '=1+1' }])).toBeNull();
  });

  it('rejects oversized raw', () => {
    const longRaw = 'x'.repeat(1001);
    expect(validateEdits([{ cell: 'A1', raw: longRaw }])).toMatch(/raw too long/);
  });

  it('accepts raw at exactly max length', () => {
    const maxRaw = 'x'.repeat(1000);
    expect(validateEdits([{ cell: 'A1', raw: maxRaw }])).toBeNull();
  });

  it('rejects too many edits', () => {
    const edits: Edit[] = [];
    for (let i = 0; i < 5001; i++) {
      edits.push({ cell: 'A1', raw: 'x' });
    }
    expect(validateEdits(edits)).toMatch(/too many edits/);
  });

  it('accepts exactly 5000 edits', () => {
    const edits: Edit[] = [];
    for (let i = 0; i < 5000; i++) {
      edits.push({ cell: 'A1', raw: 'x' });
    }
    expect(validateEdits(edits)).toBeNull();
  });

  // ── opId replay ──

  it('ignores opId replay (dedupe)', () => {
    const room = new Room('test-dedupe');
    // Simulate a client via mock ws
    const sent: string[] = [];
    const mockWs = {
      readyState: 1,
      send(data: string) { sent.push(data); },
    };
    const client = room.addClient(mockWs as never, 'Alice');

    // First edit succeeds
    room.handleEdit(client, 1, [{ cell: 'A1', raw: 'hello' }]);
    expect(room.getVersion()).toBe(1);
    expect(room.getRaw().get('A1')).toBe('hello');

    // Same opId: ignored
    room.handleEdit(client, 1, [{ cell: 'A1', raw: 'world' }]);
    expect(room.getVersion()).toBe(1);
    expect(room.getRaw().get('A1')).toBe('hello');

    // Earlier opId: also ignored
    room.handleEdit(client, 0, [{ cell: 'A1', raw: 'nope' }]);
    expect(room.getVersion()).toBe(1);

    // Next opId: succeeds
    room.handleEdit(client, 2, [{ cell: 'A1', raw: 'world' }]);
    expect(room.getVersion()).toBe(2);
    expect(room.getRaw().get('A1')).toBe('world');
  });

  it('deletes raw key when raw is empty string', () => {
    const room = new Room('test-clear');
    const mockWs = { readyState: 1, send() {} };
    const client = room.addClient(mockWs as never, 'Bob');

    room.handleEdit(client, 1, [{ cell: 'B1', raw: 'val' }]);
    expect(room.getRaw().has('B1')).toBe(true);

    room.handleEdit(client, 2, [{ cell: 'B1', raw: '' }]);
    expect(room.getRaw().has('B1')).toBe(false);
  });

  it('rejects out-of-bounds cells', () => {
    // Z is col 26 (max), row 1000 (max) → valid
    expect(validateEdits([{ cell: 'Z1000', raw: 'ok' }])).toBeNull();
    // Row 1001 → out of bounds
    expect(validateEdits([{ cell: 'A1001', raw: 'x' }])).toMatch(/cell out of bounds/);
    // AA = col 27 → out of bounds
    expect(validateEdits([{ cell: 'AA1', raw: 'x' }])).toMatch(/cell out of bounds/);
  });
});
