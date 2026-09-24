import { describe, expect, it } from 'vitest';
import { parse, refsOf } from './parser';
import type { ASTNode } from './parser';

function mustParse(src: string): ASTNode {
  const r = parse(src);
  if (!r.ok) throw new Error(`parse failed: ${src}`);
  return r.node;
}

describe('parser', () => {
  it('parses numbers', () => {
    const r = parse('42');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node).toEqual({ t: 'num', v: 42 });
  });

  it('parses decimals', () => {
    const r = parse('3.14');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node).toEqual({ t: 'num', v: 3.14 });
  });

  it('parses string literals', () => {
    const r = parse('"hello"');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node).toEqual({ t: 'str', v: 'hello' });
  });

  it('parses cell refs', () => {
    const r = parse('A1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node).toEqual({ t: 'ref', id: 'A1' });
  });

  it('$A$1 == A1', () => {
    const r = parse('$A$1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node).toEqual({ t: 'ref', id: 'A1' });
  });

  it('precedence: 2+3*4 = 14 (mul before add)', () => {
    const node = mustParse('2+3*4');
    expect(node.t).toBe('bin');
    if (node.t === 'bin') {
      expect(node.op).toBe('+');
      expect(node.l).toEqual({ t: 'num', v: 2 });
      expect(node.r).toEqual({ t: 'bin', op: '*', l: { t: 'num', v: 3 }, r: { t: 'num', v: 4 } });
    }
  });

  it('2^3^2 left-assoc = (2^3)^2', () => {
    const node = mustParse('2^3^2');
    // left-associative: ((2^3)^2)
    expect(node.t).toBe('bin');
    if (node.t === 'bin') {
      expect(node.op).toBe('^');
      expect(node.l).toEqual({ t: 'bin', op: '^', l: { t: 'num', v: 2 }, r: { t: 'num', v: 3 } });
      expect(node.r).toEqual({ t: 'num', v: 2 });
    }
  });

  it('-2^2 parses as (-2)^2', () => {
    const node = mustParse('-2^2');
    // unary - binds tighter than ^
    expect(node.t).toBe('bin');
    if (node.t === 'bin') {
      expect(node.op).toBe('^');
      expect(node.l).toEqual({ t: 'unary', op: '-', arg: { t: 'num', v: 2 } });
      expect(node.r).toEqual({ t: 'num', v: 2 });
    }
  });

  it('parens override precedence', () => {
    const node = mustParse('(2+3)*4');
    expect(node.t).toBe('bin');
    if (node.t === 'bin') {
      expect(node.op).toBe('*');
    }
  });

  it('parses ranges', () => {
    const r = parse('A1:B5');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.node).toEqual({ t: 'range', from: 'A1', to: 'B5' });
    }
  });

  it('range refs expand via refsOf', () => {
    const node = mustParse('A1:B2');
    const refs = refsOf(node);
    expect(refs).toEqual(new Set(['A1', 'A2', 'B1', 'B2']));
  });

  it('parses function calls', () => {
    const r = parse('SUM(A1:B2)');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.node.t).toBe('call');
      if (r.node.t === 'call') {
        expect(r.node.fn).toBe('SUM');
        expect(r.node.args).toHaveLength(1);
      }
    }
  });

  it('function names are case-insensitive', () => {
    const r = parse('sum(A1)');
    expect(r.ok).toBe(true);
    if (r.ok && r.node.t === 'call') {
      expect(r.node.fn).toBe('SUM');
    }
  });

  it('malformed -> {ok:false} never throws', () => {
    expect(parse('')).toEqual({ ok: false });
    expect(parse('+')).toEqual({ ok: false });
    expect(parse('1+')).toEqual({ ok: false });
    expect(parse('(1')).toEqual({ ok: false });
    expect(parse('"unterminated')).toEqual({ ok: false });
    expect(parse('1 2')).toEqual({ ok: false });
    expect(parse('$')).toEqual({ ok: false });
  });

  it('refsOf on complex expr', () => {
    const node = mustParse('A1+B2*C3');
    const refs = refsOf(node);
    expect(refs).toEqual(new Set(['A1', 'B2', 'C3']));
  });

  it('refsOf on function with range', () => {
    const node = mustParse('SUM(A1:A3,B1)');
    const refs = refsOf(node);
    expect(refs).toEqual(new Set(['A1', 'A2', 'A3', 'B1']));
  });

  it('formula > MAX_FORMULA -> {ok:false}', () => {
    const long = 'A1' + '+A1'.repeat(500);
    expect(parse(long)).toEqual({ ok: false });
  });
});
