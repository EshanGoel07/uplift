// A small, conservative Python highlighter for diff lines. It only splits text into typed pieces;
// callers render each piece as a React text node, so agent output is never interpreted as HTML.

export type TokKind = 'kw' | 'str' | 'com' | 'num' | 'tok' | 'self' | 'txt';
export interface Tok { k: TokKind; t: string }

const KW = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass',
  'raise', 'return', 'try', 'while', 'with', 'yield', 'None', 'True', 'False',
]);

// Order matters: comments and strings first, then identifiers and numbers.
const RE = /(#.*$)|("""[^]*?"""|'''[^]*?'''|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)|(\bTokenType\.[A-Za-z_]+\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|(\b\d+(?:\.\d+)?\b)/g;

export function highlightPython(line: string): Tok[] {
  const out: Tok[] = [];
  let last = 0;
  RE.lastIndex = 0;
  for (let m = RE.exec(line); m; m = RE.exec(line)) {
    if (m.index > last) out.push({ k: 'txt', t: line.slice(last, m.index) });
    const [whole, com, str, tok, ident, num] = m;
    if (com) out.push({ k: 'com', t: com });
    else if (str) out.push({ k: 'str', t: str });
    else if (tok) out.push({ k: 'tok', t: tok });
    else if (ident) out.push({ k: KW.has(ident) ? 'kw' : ident === 'self' ? 'self' : 'txt', t: ident });
    else if (num) out.push({ k: 'num', t: num });
    else out.push({ k: 'txt', t: whole });
    last = m.index + whole.length;
    if (whole.length === 0) RE.lastIndex++;
  }
  if (last < line.length) out.push({ k: 'txt', t: line.slice(last) });
  return out;
}
