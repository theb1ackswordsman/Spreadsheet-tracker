import { MAX_FORMULA } from './constants';

export type TokenKind =
  | 'NUM'
  | 'STR'
  | 'REF'
  | 'RANGE'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'OP'
  | 'FUNC'
  | 'EOF';

export interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

const REF_RE = /^\$?[A-Z]\$?[0-9]{1,4}/;
const NUM_RE = /^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/;
const FUNC_RE = /^[A-Za-z]+/;
const OPS = new Set(['+', '-', '*', '/', '^']);

export function tokenize(src: string): Token[] | null {
  if (src.length > MAX_FORMULA) return null;
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    // skip whitespace
    if (src[i] === ' ' || src[i] === '\t') {
      i++;
      continue;
    }
    const pos = i;
    const ch = src[i];

    if (ch === '(') {
      tokens.push({ kind: 'LPAREN', value: '(', pos });
      i++;
    } else if (ch === ')') {
      tokens.push({ kind: 'RPAREN', value: ')', pos });
      i++;
    } else if (ch === ',') {
      tokens.push({ kind: 'COMMA', value: ',', pos });
      i++;
    } else if (ch === ':') {
      tokens.push({ kind: 'RANGE', value: ':', pos });
      i++;
    } else if (OPS.has(ch)) {
      tokens.push({ kind: 'OP', value: ch, pos });
      i++;
    } else if (ch === '"') {
      // string literal
      i++;
      let s = '';
      while (i < src.length && src[i] !== '"') {
        s += src[i];
        i++;
      }
      if (i >= src.length) return null; // unterminated string
      i++; // skip closing quote
      tokens.push({ kind: 'STR', value: s, pos });
    } else if (ch >= '0' && ch <= '9') {
      const m = src.slice(i).match(NUM_RE);
      if (!m) return null;
      tokens.push({ kind: 'NUM', value: m[0], pos });
      i += m[0].length;
    } else if (ch === '$' || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) {
      // Could be a ref ($A$1, A1) or a function name (SUM)
      const rest = src.slice(i);
      const refMatch = rest.match(REF_RE);
      if (refMatch) {
        const after = i + refMatch[0].length;
        // Check if followed by more letters (it's a function name, not a ref)
        if (after < src.length && ((src[after] >= 'A' && src[after] <= 'Z') || (src[after] >= 'a' && src[after] <= 'z'))) {
          // It's a function name
          const fMatch = rest.match(FUNC_RE);
          if (!fMatch) return null;
          tokens.push({ kind: 'FUNC', value: fMatch[0].toUpperCase(), pos });
          i += fMatch[0].length;
        } else {
          tokens.push({ kind: 'REF', value: refMatch[0], pos });
          i += refMatch[0].length;
        }
      } else if (ch !== '$') {
        // function name
        const fMatch = rest.match(FUNC_RE);
        if (!fMatch) return null;
        tokens.push({ kind: 'FUNC', value: fMatch[0].toUpperCase(), pos });
        i += fMatch[0].length;
      } else {
        // bare $ not followed by valid ref
        return null;
      }
    } else {
      return null; // unexpected character
    }
  }
  tokens.push({ kind: 'EOF', value: '', pos: i });
  return tokens;
}
