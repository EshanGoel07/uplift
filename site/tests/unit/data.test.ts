// Data integrity: the generated site data must agree with the source of truth (data/results.json).
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ArmId, Summary, Task } from '../../src/data/types';
import { groupCounts, groupOf, winsLosses, totalRuns, githubUrl, trustTitle, WEB_LEAK_TITLE } from '../../src/data/classify';
import { ROBUSTNESS, WEB_TIERS, WEB_EXPOSED, WEB_EXPOSED_BY_ARM, FEATURED_TASK } from '../../src/data/reportFigures';

const site = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(site, p), 'utf-8');
const source = JSON.parse(read('data/results.json')) as {
  summary: Summary['summary']; arms: Summary['arms']; trust: Summary['trust']; tasks: Task[];
};
const summary = JSON.parse(read('public/data/summary.json')) as Summary;
const ARMS: ArmId[] = ['none', 'prose', 'sensors', 'both', 'handwritten', 'tuned'];

describe('source results.json', () => {
  it('has 924 runs, 77 tasks, 6 arms with 154 attempts each', () => {
    expect(source.summary.runs).toBe(924);
    expect(source.tasks).toHaveLength(77);
    expect(source.arms.map((a) => a.id)).toEqual(ARMS);
    for (const a of source.arms) expect(a.attempts).toBe(154);
    let runs = 0;
    for (const t of source.tasks) for (const a of ARMS) {
      expect(t.results[a].runs).toHaveLength(2);
      runs += t.results[a].runs.length;
    }
    expect(runs).toBe(924);
  });

  it('each task has 12 outcomes and groups compute to 43 / 23 / 11', () => {
    const solved = source.tasks.map((t) => {
      const s = {} as Record<ArmId, number>;
      for (const a of ARMS) s[a] = t.results[a].runs.filter((r) => r.resolved).length;
      return { solved: s };
    });
    const c = groupCounts(solved);
    expect(c).toEqual({ always: 43, mixed: 23, never: 11 });
    expect(c.always + c.mixed + c.never).toBe(77);
  });

  it('arm solved counts equal the sum of resolved runs', () => {
    for (const arm of source.arms) {
      const n = source.tasks.reduce((acc, t) => acc + t.results[arm.id].runs.filter((r) => r.resolved).length, 0);
      expect(n).toBe(arm.solved);
      expect(arm.rate).toBeCloseTo(arm.solved / arm.attempts, 4);
    }
  });

  it('run costs sum to the metered $21.31', () => {
    let c = 0;
    for (const t of source.tasks) for (const a of ARMS) for (const r of t.results[a].runs) c += r.cost_usd;
    expect(c).toBeCloseTo(21.31, 1);
    expect(source.summary.total_cost_usd).toBe(21.31);
  });

  it('every run has the expected field types', () => {
    for (const t of source.tasks) for (const a of ARMS) for (const r of t.results[a].runs) {
      expect(typeof r.resolved).toBe('boolean');
      expect(typeof r.cost_usd).toBe('number');
      expect(typeof r.diff).toBe('string');
      expect(Array.isArray(r.hooks)).toBe(true);
      expect([1, 2]).toContain(r.seed);
    }
  });

  it('the featured task exists and matches the brief', () => {
    const t = source.tasks.find((x) => x.id === FEATURED_TASK)!;
    expect(t.title).toMatch(/WINDOW/);
    expect(t.results.none.solved).toBe(0);
    expect(t.results.both.solved).toBe(2);
  });
});

describe('generated summary.json', () => {
  it('is small and mirrors the source', () => {
    expect(statSync(resolve(site, 'public/data/summary.json')).size).toBeLessThan(50_000);
    expect(summary.summary).toEqual(source.summary);
    expect(summary.arms).toEqual(source.arms);
    expect(summary.trust).toEqual(source.trust);
    expect(summary.tasks).toHaveLength(77);
    expect(totalRuns(summary)).toBe(924);
  });

  it('per-task metadata matches the source task files', () => {
    for (const meta of summary.tasks) {
      const t = source.tasks.find((x) => x.id === meta.id)!;
      expect(t).toBeTruthy();
      for (const a of ARMS) expect(meta.solved[a]).toBe(t.results[a].solved);
      expect(meta.group).toBe(groupOf(meta.solved));
      expect(meta.hooksFired).toBe(ARMS.some((a) => t.results[a].runs.some((r) => r.hooks.length > 0)));
    }
  });

  it('wins and losses vs No setup match reports/main.md', () => {
    const expected: Record<string, [number, number]> = {
      prose: [6, 4], sensors: [7, 6], both: [6, 7], handwritten: [4, 7], tuned: [3, 3],
    };
    for (const [arm, [w, l]] of Object.entries(expected)) {
      expect(winsLosses(summary.tasks, arm as ArmId)).toEqual({ won: w, lost: l });
    }
  });

  it('has one task file per task, identical to the source', () => {
    const files = readdirSync(resolve(site, 'public/data/tasks'));
    expect(files).toHaveLength(77);
    for (const t of source.tasks) {
      const f = JSON.parse(read(`public/data/tasks/${t.id}.json`));
      expect(f).toEqual(t);
    }
  });

  it('raw download is a byte-for-byte copy', () => {
    const h = (p: string) => createHash('sha256').update(readFileSync(resolve(site, p))).digest('hex');
    expect(h('public/data/results.json')).toBe(h('data/results.json'));
  });
});

describe('arm labels and descriptions come from the data', () => {
  it('uses the six current labels, each with a description, also in summary.json', () => {
    expect(source.arms.map((a) => a.label)).toEqual([
      'No setup', 'Tips file (generated)', 'Hooks (generated)', 'Tips + hooks', 'Generic tips file', 'Tuned by Muse Spark',
    ]);
    for (const a of source.arms) expect(a.description.length).toBeGreaterThan(10);
    expect(summary.arms.map((a) => a.description)).toEqual(source.arms.map((a) => a.description));
    expect(source.arms.find((a) => a.id === 'handwritten')!.description)
      .toBe('A generic best-practice file, written by us in the style commonly shared online.');
    for (const a of source.arms) expect(`${a.label} ${a.description}`.toLowerCase()).not.toContain('copied');
  });
});

describe('featured WINDOW example matches the story the page tells', () => {
  const task = source.tasks.find((t) => t.id === FEATURED_TASK)!;
  const runs = ARMS.flatMap((arm) => task.results[arm].runs.map((r) => ({ arm, ...r })));
  const added = (diff: string) => diff.split('\n').filter((l) => l.startsWith('+')).join('\n');
  const shortcut = runs.filter((r) => /ID_VAR_TOKENS\s*-\s*\{\s*TokenType\.WINDOW\s*\}/.test(added(r.diff)));

  it('has 12 runs; the 7 shortcut runs all fail, 4 of the other 5 pass', () => {
    expect(runs).toHaveLength(12);
    expect(shortcut).toHaveLength(7);
    expect(shortcut.every((r) => !r.resolved)).toBe(true);
    const rest = runs.filter((r) => !shortcut.includes(r));
    expect(rest.filter((r) => r.resolved)).toHaveLength(4);
    expect(rest.filter((r) => !r.resolved)).toHaveLength(1);
  });

  it('Tips + hooks 2/2, Hooks 0/2, and both got the same co-change warning', () => {
    expect(task.results.both.solved).toBe(2);
    expect(task.results.sensors.solved).toBe(0);
    for (const arm of ['both', 'sensors'] as const) {
      for (const r of task.results[arm].runs) {
        expect(r.hooks.join('\n')).toContain('co-change: you edited sqlglot/parser.py but not sqlglot/generator.py');
      }
    }
  });
});

describe('labels and links', () => {
  it('retitles only the web-leak trust card', () => {
    const titles = source.trust.map((c) => trustTitle(c.title));
    expect(titles[4]).toBe(WEB_LEAK_TITLE);
    expect(titles.filter((t) => t === WEB_LEAK_TITLE)).toHaveLength(1);
    expect(titles.slice(0, 4)).toEqual(source.trust.slice(0, 4).map((c) => c.title));
  });

  it('links test tasks to their PR and gives fresh tasks no link', () => {
    expect(githubUrl({ id: 'tobymao__sqlglot-4331', set: 'test' })).toBe('https://github.com/tobymao/sqlglot/pull/4331');
    expect(githubUrl({ id: 'tobymao__sqlglot-fresh-63296846', set: 'fresh' })).toBeNull();
  });
});

describe('report figures are internally consistent', () => {
  it('80 exposed runs = own fix diff + newer upstream code', () => {
    expect(WEB_TIERS.filter((t) => t.countsIn80).reduce((a, t) => a + t.runs, 0)).toBe(WEB_EXPOSED);
    expect(WEB_TIERS.reduce((a, t) => a + t.runs, 0)).toBe(924);
    expect(Object.values(WEB_EXPOSED_BY_ARM).reduce((a, b) => a + b, 0)).toBe(WEB_EXPOSED);
  });

  it('robustness "All tasks" row matches results.json, and every interval crosses zero', () => {
    const all = ROBUSTNESS[0].cells;
    for (const arm of source.arms.filter((a) => a.id !== 'none')) {
      const [d, lo, hi] = all[arm.id as Exclude<ArmId, 'none'>];
      expect(Number((arm.diff_vs_none * 100).toFixed(1))).toBeCloseTo(d, 5);
      expect(Number((arm.ci_low * 100).toFixed(1))).toBeCloseTo(lo, 5);
      expect(Number((arm.ci_high * 100).toFixed(1))).toBeCloseTo(hi, 5);
    }
    for (const row of ROBUSTNESS) for (const [, lo, hi] of Object.values(row.cells)) {
      expect(lo).toBeLessThan(0);
      expect(hi).toBeGreaterThanOrEqual(0);
    }
  });
});
