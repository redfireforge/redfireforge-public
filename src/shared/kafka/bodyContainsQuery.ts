/**
 * Body Contains query.
 * A value with no AND/OR is one substring.
 * AND binds tighter than OR. Parentheses group.
 * Quote a phrase that contains spaces or the words AND/OR.
 * The desktop matcher in src-tauri/src/kafka/message.rs follows the same rules.
 */

type QueryNode =
  | { kind: 'term'; value: string }
  | { kind: 'and' | 'or'; items: QueryNode[] };

type Token =
  | { kind: 'term'; value: string }
  | { kind: 'op'; value: 'and' | 'or' }
  | { kind: 'lp' }
  | { kind: 'rp' };

function jsonUnescape(input: string): string {
  return input.replace(/\\(["\\/nrt])/g, (_match, ch: string) => {
    if (ch === 'n') return '\n';
    if (ch === 't') return '\t';
    if (ch === 'r') return '\r';
    return ch;
  });
}

function normalizeQuotes(value: string): string {
  return value.replace(/[\u201c\u201d\u201e]/g, '"');
}

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lp' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rp' });
      i += 1;
      continue;
    }
    if (ch === '"') {
      let value = '';
      i += 1;
      let closed = false;
      while (i < input.length) {
        if (input[i] === '\\' && i + 1 < input.length) {
          value += input[i + 1];
          i += 2;
          continue;
        }
        if (input[i] === '"') {
          closed = true;
          i += 1;
          break;
        }
        value += input[i];
        i += 1;
      }
      if (!closed) return null;
      tokens.push({ kind: 'term', value });
      continue;
    }
    let value = '';
    while (i < input.length && !' \t\n\r()"'.includes(input[i])) {
      value += input[i];
      i += 1;
    }
    const word = value.toUpperCase();
    if (word === 'AND' || word === 'OR') {
      tokens.push({ kind: 'op', value: word === 'AND' ? 'and' : 'or' });
    } else {
      tokens.push({ kind: 'term', value });
    }
  }
  return tokens;
}

function parseFactor(tokens: Token[], pos: number): { node: QueryNode; pos: number } | null {
  const token = tokens[pos];
  if (!token) return null;
  if (token.kind === 'term') return { node: { kind: 'term', value: token.value }, pos: pos + 1 };
  if (token.kind !== 'lp') return null;
  const inner = parseOr(tokens, pos + 1);
  if (!inner || tokens[inner.pos]?.kind !== 'rp') return null;
  return { node: inner.node, pos: inner.pos + 1 };
}

function isOperator(token: Token | undefined, op: 'and' | 'or'): boolean {
  return token?.kind === 'op' && token.value === op;
}

function parseAnd(tokens: Token[], pos: number): { node: QueryNode; pos: number } | null {
  const first = parseFactor(tokens, pos);
  if (!first) return null;
  const items = [first.node];
  let cursor = first.pos;
  while (isOperator(tokens[cursor], 'and')) {
    const next = parseFactor(tokens, cursor + 1);
    if (!next) return null;
    items.push(next.node);
    cursor = next.pos;
  }
  return { node: items.length === 1 ? items[0] : { kind: 'and', items }, pos: cursor };
}

function parseOr(tokens: Token[], pos: number): { node: QueryNode; pos: number } | null {
  const first = parseAnd(tokens, pos);
  if (!first) return null;
  const items = [first.node];
  let cursor = first.pos;
  while (isOperator(tokens[cursor], 'or')) {
    const next = parseAnd(tokens, cursor + 1);
    if (!next) return null;
    items.push(next.node);
    cursor = next.pos;
  }
  return { node: items.length === 1 ? items[0] : { kind: 'or', items }, pos: cursor };
}

function parseQuery(input: string): QueryNode | null {
  const tokens = tokenize(input);
  if (!tokens) return null;
  // One quoted phrase has no operator, but the quotes are not part of the text.
  if (!tokens.some((token) => token.kind === 'op')) {
    if (tokens.length === 1 && tokens[0].kind === 'term' && tokens[0].value !== input) {
      return { kind: 'term', value: tokens[0].value };
    }
    return null;
  }
  const parsed = parseOr(tokens, 0);
  if (!parsed || parsed.pos !== tokens.length) return null;
  return parsed.node;
}

function termMatches(raw: string, text: string, needle: string): boolean {
  const normalized = needle.toLowerCase();
  if (!normalized) return true;
  const needleText = jsonUnescape(normalized);
  return raw.includes(normalized)
    || raw.includes(needleText)
    || text.includes(normalized)
    || text.includes(needleText);
}

function evalQuery(node: QueryNode, raw: string, text: string): boolean {
  if (node.kind === 'term') return termMatches(raw, text, node.value);
  if (node.kind === 'and') return node.items.every((item) => evalQuery(item, raw, text));
  return node.items.some((item) => evalQuery(item, raw, text));
}

/** Case-insensitive body match, including AND/OR queries. */
export function kafkaBodyHasText(value: string, needle: string): boolean {
  const normalized = normalizeQuotes(needle).trim();
  if (!normalized) return true;
  const raw = value.toLowerCase();
  const text = jsonUnescape(raw);
  const query = parseQuery(normalized);
  if (!query) return termMatches(raw, text, normalized);
  return evalQuery(query, raw, text);
}
