import { describe, expect, it } from 'vitest';
import { parse } from './parser';
import { evaluate } from './evaluator';
import type { CellId, Result } from './types';
import type { ASTNode } from './parser';

function eval_(src: string, cells: Map<CellId, Result> = new Map()): Result {
  const r = parse(src);
  if (!r.ok) throw new Error(`parse failed: ${src}`);
  const get = (id: CellId): Result => cells.get(id) ?? { v: null, e: null };
  return evaluate(r.node, get);
}

describe('evaluator', () => {
  it('precedence: 2+3*4=14', () => {
    expect(eval_('2+3*4')).toEqual({ v: 14, e: null });
  });

  it('2^3^2=64 (left-associative)', () => {
    expect(eval_('2^3^2')).toEqual({ v: 64, e: null });
  });

  it('-2^2=4', () => {
    expect(eval_('-2^2')).toEqual({ v: 4, e: null });
  });

  it('parens: (2+3)*4=20', () => {
    expect(eval_('(2+3)*4')).toEqual({ v: 20, e: null });
  });

  it('$A$1 == A1 (same ref)', () => {
    const cells = new Map<CellId, Result>([['A1', { v: 42, e: null }]]);
    expect(eval_('$A$1', cells)).toEqual({ v: 42, e: null });
  });

  it('range refs expand in SUM', () => {
    const cells = new Map<CellId, Result>([
      ['A1', { v: 1, e: null }],
      ['A2', { v: 2, e: null }],
      ['A3', { v: 3, e: null }],
    ]);
    expect(eval_('SUM(A1:A3)', cells)).toEqual({ v: 6, e: null });
  });

  it('range > MAX_RANGE -> #REF!', () => {
    // A1:Z1000 = 26*1000 = 26000 > 10000
    expect(eval_('SUM(A1:Z1000)')).toEqual({ v: null, e: '#REF!' });
  });

  it('out-of-grid ref -> #REF!', () => {
    // Z1001 is out of bounds (ROWS=1000)
    expect(eval_('Z1001')).toEqual({ v: null, e: '#REF!' });
  });

  it('x/0 -> #DIV/0!', () => {
    expect(eval_('1/0')).toEqual({ v: null, e: '#DIV/0!' });
  });

  it('text in arithmetic -> #VALUE!', () => {
    const cells = new Map<CellId, Result>([['A1', { v: 'hello', e: null }]]);
    expect(eval_('A1+1', cells)).toEqual({ v: null, e: '#VALUE!' });
  });

  it('empty cell = 0 in arithmetic', () => {
    expect(eval_('A1+1')).toEqual({ v: 1, e: null });
  });

  it('SUM of no values = 0', () => {
    expect(eval_('SUM(A1:A3)')).toEqual({ v: 0, e: null });
  });

  it('AVERAGE of no numbers -> #DIV/0!', () => {
    expect(eval_('AVERAGE(A1:A3)')).toEqual({ v: null, e: '#DIV/0!' });
  });

  it('AVERAGE skips empty+text', () => {
    const cells = new Map<CellId, Result>([
      ['A1', { v: 1, e: null }],
      ['A2', { v: null, e: null }],
      ['A3', { v: 'text', e: null }],
      ['A4', { v: 3, e: null }],
    ]);
    expect(eval_('AVERAGE(A1:A4)', cells)).toEqual({ v: 2, e: null });
  });

  it('MIN of no values = 0', () => {
    expect(eval_('MIN(A1:A3)')).toEqual({ v: 0, e: null });
  });

  it('MAX of no values = 0', () => {
    expect(eval_('MAX(A1:A3)')).toEqual({ v: 0, e: null });
  });

  it('COUNT counts numbers only', () => {
    const cells = new Map<CellId, Result>([
      ['A1', { v: 1, e: null }],
      ['A2', { v: null, e: null }],
      ['A3', { v: 'text', e: null }],
      ['A4', { v: 0, e: null }],
    ]);
    expect(eval_('COUNT(A1:A4)', cells)).toEqual({ v: 2, e: null });
  });

  it('unknown fn -> #NAME?', () => {
    expect(eval_('FOO(1)')).toEqual({ v: null, e: '#NAME?' });
  });

  it('error propagation (first error wins)', () => {
    const cells = new Map<CellId, Result>([
      ['A1', { v: null, e: '#REF!' }],
      ['B1', { v: null, e: '#DIV/0!' }],
    ]);
    // A1 is evaluated first (left operand), so #REF! propagates
    expect(eval_('A1+B1', cells)).toEqual({ v: null, e: '#REF!' });
  });

  it('error propagation in SUM', () => {
    const cells = new Map<CellId, Result>([
      ['A1', { v: 1, e: null }],
      ['A2', { v: null, e: '#VALUE!' }],
    ]);
    expect(eval_('SUM(A1:A2)', cells)).toEqual({ v: null, e: '#VALUE!' });
  });

  it('depth > 64 guard', () => {
    // Build deeply nested expr: (((((...1...)))))
    let src = '1';
    for (let i = 0; i < 70; i++) {
      src = `-${src}`;
    }
    // This should hit depth > 64
    const r = parse(src);
    if (r.ok) {
      const result = evaluate(r.node, () => ({ v: null, e: null }));
      expect(result.e).toBe('#VALUE!');
    }
  });

  it('MIN/MAX with values', () => {
    const cells = new Map<CellId, Result>([
      ['A1', { v: 3, e: null }],
      ['A2', { v: 1, e: null }],
      ['A3', { v: 5, e: null }],
    ]);
    expect(eval_('MIN(A1:A3)', cells)).toEqual({ v: 1, e: null });
    expect(eval_('MAX(A1:A3)', cells)).toEqual({ v: 5, e: null });
  });

  it('SUM with multiple args', () => {
    const cells = new Map<CellId, Result>([
      ['A1', { v: 1, e: null }],
      ['B1', { v: 2, e: null }],
    ]);
    expect(eval_('SUM(A1,B1)', cells)).toEqual({ v: 3, e: null });
  });

  it('nested function calls', () => {
    const cells = new Map<CellId, Result>([
      ['A1', { v: 5, e: null }],
      ['A2', { v: 10, e: null }],
    ]);
    expect(eval_('SUM(A1,A2)*2', cells)).toEqual({ v: 30, e: null });
  });

  it('string literal evaluates to string', () => {
    const r = parse('"test"');
    if (r.ok) {
      const result = evaluate(r.node, () => ({ v: null, e: null }));
      expect(result).toEqual({ v: 'test', e: null });
    }
  });
});
