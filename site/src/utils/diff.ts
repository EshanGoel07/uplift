// Parses a unified git diff into typed lines. The text is never interpreted as HTML: callers render
// `text` as React text nodes only.

export type DiffLineType = 'meta' | 'file' | 'hunk' | 'add' | 'del' | 'ctx' | 'note';

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface DiffFile {
  path: string;
  adds: number;
  dels: number;
  lines: DiffLine[];
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  if (!text) return files;
  let cur: DiffFile | null = null;
  let oldNo = 0, newNo = 0, inHunk = false;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  const start = (path: string, header: string) => {
    cur = { path, adds: 0, dels: 0, lines: [{ type: 'file', text: header, oldNo: null, newNo: null }] };
    files.push(cur);
    inHunk = false;
  };

  for (const raw of lines) {
    if (raw.startsWith('diff --git ')) {
      const m = / b\/(.+)$/.exec(raw);
      start(m ? m[1] : raw.slice(11), raw);
      continue;
    }
    if (!cur) start('(patch)', '');
    const f = cur as unknown as DiffFile;
    const h = HUNK.exec(raw);
    if (h) {
      oldNo = Number(h[1]); newNo = Number(h[2]); inHunk = true;
      f.lines.push({ type: 'hunk', text: raw, oldNo: null, newNo: null });
    } else if (!inHunk) {
      f.lines.push({ type: 'meta', text: raw, oldNo: null, newNo: null });
    } else if (raw.startsWith('+')) {
      f.adds++;
      f.lines.push({ type: 'add', text: raw.slice(1), oldNo: null, newNo: newNo++ });
    } else if (raw.startsWith('-')) {
      f.dels++;
      f.lines.push({ type: 'del', text: raw.slice(1), oldNo: oldNo++, newNo: null });
    } else if (raw.startsWith('\\')) {
      f.lines.push({ type: 'note', text: raw, oldNo: null, newNo: null });
    } else {
      f.lines.push({ type: 'ctx', text: raw.startsWith(' ') ? raw.slice(1) : raw, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return files;
}

export const diffStats = (files: DiffFile[]) => ({
  files: files.length,
  adds: files.reduce((a, f) => a + f.adds, 0),
  dels: files.reduce((a, f) => a + f.dels, 0),
  lines: files.reduce((a, f) => a + f.lines.length, 0),
});
