import { COLS, ROWS, MAX_RANGE, MAX_DEPTH } from './constants';
import type { CellId, Result, ErrCode } from './types';
import type { ASTNode } from './parser';
import { splitRef, isValidRef, colToLetter } from './parser';

const EMPTY: Result = { v: null, e: null };
const KNOWN_FNS = new Set(['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT']);

function errResult(code: ErrCode): Result {
  return { v: null, e: code };
}

function numResult(v: number): Result {
  return { v, e: null };
}

function isErr(r: Result): boolean {
  return r.e !== null;
}

function asNumber(r: Result): number | ErrCode {
  if (r.e !== null) return r.e;
  if (r.v === null) return 0; // empty cell = 0 in arithmetic
  if (typeof r.v === 'number') return r.v;
  // text in arithmetic -> #VALUE!
  return '#VALUE!';
}

// Expand a range into individual cell results
function expandRange(
  from: CellId,
  to: CellId,
  get: (id: CellId) => Result,
): Result[] | ErrCode {
  const f = splitRef(from);
  const t = splitRef(to);
  const minCol = Math.min(f.col, t.col);
  const maxCol = Math.max(f.col, t.col);
  const minRow = Math.min(f.row, t.row);
  const maxRow = Math.max(f.row, t.row);

  // Check bounds
  if (minCol < 0 || maxCol >= COLS || minRow < 0 || maxRow >= ROWS) {
    return '#REF!';
  }
  // Check range size
  const size = (maxCol - minCol + 1) * (maxRow - minRow + 1);
  if (size > MAX_RANGE) return '#REF!';

  const results: Result[] = [];
  for (let c = minCol; c <= maxCol; c++) {
    for (let r = minRow; r <= maxRow; r++) {
      const id = colToLetter(c) + (r + 1).toString();
      results.push(get(id));
    }
  }
  return results;
}

function evalCall(
  fn: string,
  args: ASTNode[],
  get: (id: CellId) => Result,
  depth: number,
): Result {
  if (!KNOWN_FNS.has(fn)) return errResult('#NAME?');

  // Collect all values (expanding ranges)
  const values: Result[] = [];
  for (const arg of args) {
    if (arg.t === 'range') {
      const expanded = expandRange(arg.from, arg.to, get);
      if (typeof expanded === 'string') return errResult(expanded);
      for (const r of expanded) {
        // Check for error propagation inside ranges
        if (isErr(r)) return r;
        values.push(r);
      }
    } else {
      const r = evalNode(arg, get, depth);
      if (isErr(r)) return r;
      values.push(r);
    }
  }

  switch (fn) {
    case 'SUM': {
      let sum = 0;
      for (const r of values) {
        if (r.v === null) continue; // skip empty
        if (typeof r.v === 'string') continue; // skip text
        sum += r.v;
      }
      return numResult(sum);
    }
    case 'AVERAGE': {
      let sum = 0;
      let count = 0;
      for (const r of values) {
        if (r.v === null) continue; // skip empty
        if (typeof r.v === 'string') continue; // skip text
        sum += r.v;
        count++;
      }
      if (count === 0) return errResult('#DIV/0!');
      return numResult(sum / count);
    }
    case 'MIN': {
      let min = Infinity;
      let found = false;
      for (const r of values) {
        if (r.v === null) continue;
        if (typeof r.v === 'string') continue;
        if (r.v < min) min = r.v;
        found = true;
      }
      return numResult(found ? min : 0);
    }
    case 'MAX': {
      let max = -Infinity;
      let found = false;
      for (const r of values) {
        if (r.v === null) continue;
        if (typeof r.v === 'string') continue;
        if (r.v > max) max = r.v;
        found = true;
      }
      return numResult(found ? max : 0);
    }
    case 'COUNT': {
      let count = 0;
      for (const r of values) {
        if (typeof r.v === 'number') count++;
      }
      return numResult(count);
    }
    default:
      return errResult('#NAME?');
  }
}

function evalNode(
  node: ASTNode,
  get: (id: CellId) => Result,
  depth: number,
): Result {
  if (depth > MAX_DEPTH) return errResult('#VALUE!');

  switch (node.t) {
    case 'num':
      return numResult(node.v);
    case 'str':
      return { v: node.v, e: null };
    case 'ref': {
      if (!isValidRef(node.id)) return errResult('#REF!');
      return get(node.id);
    }
    case 'range': {
      // Bare range outside a function call: expand and return first? Actually per spec this shouldn't appear as a bare value. Treat as #VALUE! if not in a call context.
      // Actually ranges can appear in function args; evalCall handles those.
      // If a range appears as a standalone expression, that's a usage error.
      return errResult('#VALUE!');
    }
    case 'unary': {
      const arg = evalNode(node.arg, get, depth + 1);
      if (isErr(arg)) return arg;
      const n = asNumber(arg);
      if (typeof n === 'string') return errResult(n);
      return numResult(-n);
    }
    case 'bin': {
      const l = evalNode(node.l, get, depth + 1);
      if (isErr(l)) return l;
      const r = evalNode(node.r, get, depth + 1);
      if (isErr(r)) return r;
      const ln = asNumber(l);
      if (typeof ln === 'string') return errResult(ln);
      const rn = asNumber(r);
      if (typeof rn === 'string') return errResult(rn);
      switch (node.op) {
        case '+':
          return numResult(ln + rn);
        case '-':
          return numResult(ln - rn);
        case '*':
          return numResult(ln * rn);
        case '/':
          if (rn === 0) return errResult('#DIV/0!');
          return numResult(ln / rn);
        case '^':
          return numResult(Math.pow(ln, rn));
        default:
          return errResult('#VALUE!');
      }
    }
    case 'call':
      return evalCall(node.fn, node.args, get, depth + 1);
  }
}

export function evaluate(
  node: ASTNode,
  get: (id: CellId) => Result,
): Result {
  return evalNode(node, get, 0);
}
