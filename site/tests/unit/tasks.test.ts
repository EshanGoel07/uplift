// Every bug and run on the page must be inspectable, and the worked example's approach labels must
// agree with what the agents actually wrote.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ArmId, Summary, Task } from '../../src/data/types';
import { FEATURED_APPROACHES, FEATURED_TASK, SHORTCUT_LINE } from '../../src/data/reportFigures';

const site = resolve(__dirname, '../..');
const read = (p: string) => JSON.parse(readFileSync(resolve(site, p), 'utf-8'));
const summary = read('public/data/summary.json') as Summary;
const ARMS = summary.arms.map((a) => a.id);

describe('all 77 task files load with 6 conditions x 2 runs', () => {
  const files = readdirSync(resolve(site, 'public/data/tasks')).filter((f) => f.endsWith('.json'));

  it('one file per bug in the summary', () => {
    expect(files).toHaveLength(77);
    expect(new Set(files.map((f) => f.replace(/\.json$/, '')))).toEqual(new Set(summary.tasks.map((t) => t.id)));
  });

  it('924 runs, each with an outcome, a diff string, hook messages and a cost', () => {
    let runs = 0;
    for (const meta of summary.tasks) {
      const t = read(`public/data/tasks/${meta.id}.json`) as Task;
      expect(t.issue.length, meta.id).toBeGreaterThan(20);
      for (const arm of ARMS) {
        const rs = t.results[arm].runs;
        expect(rs, `${meta.id} ${arm}`).toHaveLength(2);
        expect(rs.filter((r) => r.resolved).length).toBe(meta.solved[arm]);
        for (const r of rs) {
          expect(typeof r.resolved).toBe('boolean');
          expect(typeof r.diff).toBe('string');
          expect(Array.isArray(r.hooks)).toBe(true);
          expect(r.cost_usd).toBeGreaterThan(0);
          runs++;
        }
      }
    }
    expect(runs).toBe(924);
  });
});

describe('worked example: approach labels agree with the diffs', () => {
  const task = read(`public/data/tasks/${FEATURED_TASK}.json`) as Task;
  const added = (d: string) => d.split('\n').filter((l) => l.startsWith('+')).join('\n');
  const isShortcut = (d: string) => /ID_VAR_TOKENS\s*-\s*\{\s*TokenType\.WINDOW\s*\}/.test(added(d));

  it('shortcut runs are exactly the ones whose patch adds the shortcut line, and all failed', () => {
    for (const arm of ARMS as ArmId[]) {
      task.results[arm].runs.forEach((r, i) => {
        const label = FEATURED_APPROACHES[arm][i];
        expect(isShortcut(r.diff), `${arm} ${i}`).toBe(label === 'shortcut');
        if (label === 'shortcut') expect(r.resolved).toBe(false);
        if (label === 'other') { expect(added(r.diff)).toContain('AMBIGUOUS_ALIAS_TOKENS'); expect(r.resolved).toBe(false); }
        if (label === 'lookahead') expect(r.resolved).toBe(true);
      });
    }
  });

  it('counts are 7 shortcut, 4 look-ahead, 1 other; the quoted line appears in the diffs', () => {
    const all = Object.values(FEATURED_APPROACHES).flat();
    expect(all.filter((a) => a === 'shortcut')).toHaveLength(7);
    expect(all.filter((a) => a === 'lookahead')).toHaveLength(4);
    expect(all.filter((a) => a === 'other')).toHaveLength(1);
    expect(task.results.none.runs[0].diff).toContain(`+    ${SHORTCUT_LINE}`);
  });
});
