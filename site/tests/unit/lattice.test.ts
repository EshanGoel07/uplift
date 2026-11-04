// The run lattice's layout must represent the study exactly: every task, condition and repeat.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { instanceIndex, latticeLayout, outcomeAt } from '../../src/scenes/RunLattice/layout';

interface Summary { tasks: { id: string; set: string; solved: Record<string, number> }[]; arms: { id: string; attempts: number; solved: number }[] }
const summary = JSON.parse(readFileSync(resolve(__dirname, '../../public/data/summary.json'), 'utf-8')) as Summary;
const tasks = [...summary.tasks.filter((t) => t.set === 'test'), ...summary.tasks.filter((t) => t.set === 'fresh')];
const arms = summary.arms;

describe.each([['wide', true], ['tall', false]])('%s arrangement', (_, wide) => {
  const L = latticeLayout(tasks, arms, wide as boolean);

  it('holds all 924 runs: 77 tasks, 6 conditions, 2 repeats', () => {
    expect(L.bugs).toBe(77);
    expect(L.lanes).toBe(6);
    expect(L.repeats).toBe(2);
    expect(L.count).toBe(924);
    expect(L.xz).toHaveLength(924 * 2);
  });

  it('gives every run its own position', () => {
    const seen = new Set<string>();
    for (let n = 0; n < L.count; n++) seen.add(`${L.xz[n * 2].toFixed(4)},${L.xz[n * 2 + 1].toFixed(4)}`);
    expect(seen.size).toBe(924);
  });

  it('keeps each bug a contiguous block of 12 instances, so one bug can update alone', () => {
    expect(L.perBug).toBe(12);
    const ids = new Set<number>();
    for (let b = 0; b < L.bugs; b++) {
      for (let r = 0; r < L.lanes; r++) {
        for (let q = 0; q < L.repeats; q++) {
          const n = instanceIndex(L, b, r, q);
          expect(Math.floor(n / L.perBug)).toBe(b);
          ids.add(n);
        }
      }
    }
    expect(ids.size).toBe(924);
    expect(Math.max(...ids)).toBe(923);
  });
});

describe('outcomes', () => {
  it('the solved cubes per condition match the study totals', () => {
    for (const a of arms) {
      let solved = 0;
      for (const t of tasks) for (let q = 0; q < 2; q++) if (outcomeAt(t, a.id, q)) solved++;
      expect(solved, a.id).toBe(a.solved);
    }
  });
  it('all six conditions are present, and test bugs come first', () => {
    expect(arms.map((a) => a.id)).toEqual(['none', 'prose', 'sensors', 'both', 'handwritten', 'tuned']);
    expect(tasks.filter((t) => t.set === 'test')).toHaveLength(39);
    expect(tasks.slice(0, 39).every((t) => t.set === 'test')).toBe(true);
  });
});
