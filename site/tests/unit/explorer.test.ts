// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDiff, diffStats } from '../../src/utils/diff';
import { renderIssueMarkdown } from '../../src/utils/markdown';

describe('parseDiff', () => {
  it('parses files, hunks and line numbers', () => {
    const d = [
      'diff --git a/x.py b/x.py',
      'index 1..2 100644',
      '--- a/x.py',
      '+++ b/x.py',
      '@@ -10,3 +10,4 @@ class A:',
      ' keep',
      '-old',
      '+new',
      '+added',
      ' tail',
    ].join('\n');
    const [f] = parseDiff(d);
    expect(f.path).toBe('x.py');
    expect(f.adds).toBe(2);
    expect(f.dels).toBe(1);
    const add = f.lines.find((l) => l.text === 'added')!;
    expect(add.type).toBe('add');
    expect(add.newNo).toBe(12);
    expect(f.lines.find((l) => l.text === 'old')!.oldNo).toBe(11);
    expect(f.lines.find((l) => l.text === 'tail')!.newNo).toBe(13);
  });

  it('handles an empty patch', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('parses every real diff in the study without losing lines', () => {
    const tasksDir = resolve(__dirname, '../../public/data/tasks');
    const t = JSON.parse(readFileSync(resolve(tasksDir, 'tobymao__sqlglot-fresh-63296846.json'), 'utf-8'));
    const files = parseDiff(t.results.both.runs[0].diff);
    expect(files.map((f) => f.path)).toContain('sqlglot/parser.py');
    const s = diffStats(files);
    expect(s.adds).toBeGreaterThan(0);
    expect(s.lines).toBe(t.results.both.runs[0].diff.replace(/\n$/, '').split('\n').length);
  });

  it('keeps markup in diff text as plain text', () => {
    const [f] = parseDiff('diff --git a/a b/a\n@@ -1 +1 @@\n+<img src=x onerror=alert(1)>');
    expect(f.lines.at(-1)!.text).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('renderIssueMarkdown', () => {
  it('strips images, scripts, handlers and unsafe links', () => {
    const html = renderIssueMarkdown([
      '# Bug',
      '![x](https://evil.example/pixel.png)',
      '<img src="https://evil.example/a.png">',
      '<script>alert(1)</script>',
      '<a href="javascript:alert(1)" onclick="x()">bad</a>',
      '[ok](https://github.com/tobymao/sqlglot)',
      '```python\nprint("<b>hi</b>")\n```',
    ].join('\n\n'));
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onclick/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toMatch(/href="https:\/\/github.com\/tobymao\/sqlglot"/);
    expect(html).toMatch(/rel="noopener noreferrer nofollow"/);
    expect(html).toMatch(/&lt;b&gt;hi&lt;\/b&gt;/);
  });

  it('renders every issue in the study without images', () => {
    const src = JSON.parse(readFileSync(resolve(__dirname, '../../data/results.json'), 'utf-8'));
    for (const t of src.tasks) {
      const html = renderIssueMarkdown(t.issue);
      expect(html).not.toMatch(/<img|<script|<iframe/i);
    }
  });
});
