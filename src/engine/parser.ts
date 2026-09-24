import { COLS, ROWS, MAX_RANGE, MAX_FORMULA, MAX_DEPTH } from './constants';
import type { CellId } from './types';
import { tokenize, type Token } from './tokenizer';

// AST node types
export type ASTNode =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; id: CellId }
  | { t: 'range'; from: CellId; to: CellId }
  | { t: 'unary'; op: '-'; arg: ASTNode }
  | { t: 'bin'; op: string; l: ASTNode; r: ASTNode }
  | { t: 'call'; fn: string; args: ASTNode[] };

export type ParseResult =
  | { ok: true; node: ASTNode }
  | { ok: false };

// Normalize a ref: strip $ signs
function normalizeRef(raw: string): string {
  return raw.replace(/\$/g, '');
}

function parseCol(s: string): number {
  // A=0 .. Z=25
  return s.charCodeAt(0) - 65;
}

function parseRow(s: string): number {
  // 1-based in text, 0-based internally
  return parseInt(s, 10) - 1;
}

function splitRef(ref: string): { col: number; row: number } {
  const letter = ref[0];
  const numStr = ref.slice(1);
  return { col: parseCol(letter), row: parseRow(numStr) };
}

function isValidRef(ref: string): boolean {
  const { col, row } = splitRef(ref);
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

// Pratt parser
class Parser {
  private tokens: Token[];
  private pos: number;
  private failed: boolean;
  private depth: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
    this.failed = false;
    this.depth = 0;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const t = this.tokens[this.pos];
    this.pos++;
    return t;
  }

  private expect(kind: string): Token | null {
    const t = this.peek();
    if (t.kind !== kind) {
      this.failed = true;
      return null;
    }
    return this.advance();
  }

  // Binding power (precedence)
  private bp(op: string): number {
    switch (op) {
      case '+':
      case '-':
        return 1;
      case '*':
      case '/':
        return 2;
      case '^':
        return 3;
      default:
        return 0;
    }
  }

  // Null denotation (prefix)
  private nud(): ASTNode | null {
    const tok = this.peek();
    if (tok.kind === 'NUM') {
      this.advance();
      return { t: 'num', v: parseFloat(tok.value) };
    }
    if (tok.kind === 'STR') {
      this.advance();
      return { t: 'str', v: tok.value };
    }
    if (tok.kind === 'REF') {
      this.advance();
      const ref = normalizeRef(tok.value);
      // Check for range
      if (this.peek().kind === 'RANGE') {
        // It's actually the : token indicating a range
        // But we tokenized : as RANGE kind
        return this.parseRange(ref);
      }
      return { t: 'ref', id: ref };
    }
    if (tok.kind === 'FUNC') {
      this.advance();
      const fn = tok.value;
      if (this.expect('LPAREN') === null) return null;
      const args: ASTNode[] = [];
      if (this.peek().kind !== 'RPAREN') {
        const a = this.expr(0);
        if (a === null) return null;
        args.push(a);
        while (this.peek().kind === 'COMMA') {
          this.advance();
          const b = this.expr(0);
          if (b === null) return null;
          args.push(b);
        }
      }
      if (this.expect('RPAREN') === null) return null;
      return { t: 'call', fn, args };
    }
    if (tok.kind === 'LPAREN') {
      this.advance();
      this.depth++;
      if (this.depth > MAX_DEPTH) { this.failed = true; return null; }
      const inner = this.expr(0);
      this.depth--;
      if (inner === null) return null;
      if (this.expect('RPAREN') === null) return null;
      return inner;
    }
    if (tok.kind === 'OP' && tok.value === '-') {
      this.advance();
      // Unary minus has highest prefix binding power
      const arg = this.expr(4);
      if (arg === null) return null;
      return { t: 'unary', op: '-', arg };
    }
    this.failed = true;
    return null;
  }

  private parseRange(fromRef: string): ASTNode | null {
    this.advance(); // consume ':'
    const tok = this.peek();
    if (tok.kind !== 'REF') {
      this.failed = true;
      return null;
    }
    this.advance();
    const toRef = normalizeRef(tok.value);
    return { t: 'range', from: fromRef, to: toRef };
  }

  // Left denotation (infix)
  private led(left: ASTNode, op: string): ASTNode | null {
    // All operators are LEFT-associative (including ^)
    const right = this.expr(this.bp(op));
    if (right === null) return null;
    return { t: 'bin', op, l: left, r: right };
  }

  expr(minBp: number): ASTNode | null {
    if (this.failed) return null;
    let left = this.nud();
    if (left === null || this.failed) return null;
    while (true) {
      const tok = this.peek();
      if (tok.kind !== 'OP') break;
      const power = this.bp(tok.value);
      if (power <= minBp) break;
      this.advance();
      left = this.led(left, tok.value);
      if (left === null) return null;
    }
    return left;
  }

  parseTop(): ParseResult {
    const node = this.expr(0);
    if (node === null || this.failed || this.peek().kind !== 'EOF') {
      return { ok: false };
    }
    return { ok: true, node };
  }
}

export function parse(src: string): ParseResult {
  if (src.length > MAX_FORMULA) return { ok: false };
  const tokens = tokenize(src);
  if (tokens === null) return { ok: false };
  const parser = new Parser(tokens);
  return parser.parseTop();
}

// Extract all CellIds referenced by a node (expanding ranges)
export function refsOf(node: ASTNode): Set<CellId> {
  const refs = new Set<CellId>();
  collectRefs(node, refs);
  return refs;
}

function colToLetter(col: number): string {
  return String.fromCharCode(65 + col);
}

function collectRefs(node: ASTNode, refs: Set<CellId>): void {
  switch (node.t) {
    case 'num':
    case 'str':
      break;
    case 'ref':
      refs.add(node.id);
      break;
    case 'range': {
      const f = splitRef(node.from);
      const t = splitRef(node.to);
      const minCol = Math.min(f.col, t.col);
      const maxCol = Math.max(f.col, t.col);
      const minRow = Math.min(f.row, t.row);
      const maxRow = Math.max(f.row, t.row);
      for (let c = minCol; c <= maxCol; c++) {
        for (let r = minRow; r <= maxRow; r++) {
          refs.add(colToLetter(c) + (r + 1).toString());
        }
      }
      break;
    }
    case 'unary':
      collectRefs(node.arg, refs);
      break;
    case 'bin':
      collectRefs(node.l, refs);
      collectRefs(node.r, refs);
      break;
    case 'call':
      for (const arg of node.args) {
        collectRefs(arg, refs);
      }
      break;
  }
}

export { splitRef, isValidRef, normalizeRef, colToLetter };
