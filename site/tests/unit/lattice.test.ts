// The run lattice's layout must represent the study exactly: every task, condition and repeat.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUG, LANE, REP, TILE_H, TILE_W, VISIBLE_H, VISIBLE_W, instanceIndex, latticeLayout, outcomeAt } from '../../src/scenes/RunLattice/layout';

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
    expect(L.pos).toHaveLength(924 * 3);
    expect(L.dir).toHaveLength(924 * 3);
  });

  it('gives every run its own position', () => {
    const seen = new Set<string>();
    for (let n = 0; n < L.count; n++) seen.add(`${L.pos[n * 3].toFixed(4)},${L.pos[n * 3 + 1].toFixed(4)},${L.pos[n * 3 + 2].toFixed(4)}`);
    expect(seen.size).toBe(924);
  });

  it('keeps the two repeats of a pair closer together than two neighbouring conditions', () => {
    const across = wide ? 1 : 0;
    const v = (b: number, r: number, q: number) => L.pos[instanceIndex(L, b, r, q) * 3 + across];
    for (let b = 0; b < L.bugs; b += 7) {
      for (let r = 0; r < L.lanes - 1; r++) expect(Math.abs(v(b, r, 0) - v(b, r, 1))).toBeLessThan(Math.abs(v(b, r, 1) - v(b, r + 1, 0)));
    }
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

describe('pointer targets', () => {
  it('meet across rows and columns, so a pointer never falls between two tiles', () => {
    expect(TILE_H).toBeGreaterThan(LANE - 2 * REP);
    expect(TILE_W).toBeGreaterThan(BUG);
  });
  it('leave the visible tile inside its quad', () => {
    expect(VISIBLE_W).toBeLessThanOrEqual(1);
    expect(VISIBLE_H).toBeLessThanOrEqual(1);
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
