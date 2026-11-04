// The story models must say what the code says. They are data, so the claims can be checked directly.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { changedFiles, cutawayModel, diffStrokes, issueStrokes, workspaceModel } from '../../src/data/models';
import { repoLayout, type RepoFile } from '../../src/data/repoLayout';
import tree from '../../src/data/repoTree.json';
import { gradingModel } from '../../src/data/gradingModel';
import { CONDITIONS, GRADING_STEPS, workspaceLayers } from '../../src/data/method';
import type { ArmId } from '../../src/data/types';

const ARMS: ArmId[] = ['none', 'prose', 'sensors', 'both', 'handwritten', 'tuned'];

const root = resolve(__dirname, '../../..');
const task = JSON.parse(readFileSync(resolve(__dirname, '../../public/data/tasks/tobymao__sqlglot-fresh-63296846.json'), 'utf-8'));

describe('workspace model', () => {
  const shown = (m: ReturnType<typeof workspaceModel>) => m.parts.filter((p) => !p.inert && p.poses.some((q) => q.on > 0.5));
  it.each(ARMS)('%s shows exactly its real layers, with a pose for every state', (arm) => {
    const m = workspaceModel(arm);
    expect(shown(m).map((p) => p.id).sort()).toEqual(workspaceLayers(arm).map((l) => l.id).sort());
    for (const p of m.parts) expect(p.poses).toHaveLength(m.views.length);
    expect(m.lights).toHaveLength(m.views.length);
    expect(m.steps).toHaveLength(m.views.length);
  });
  it.each(ARMS)('%s shows guidance and hooks only if it installed them', (arm) => {
    const ids = shown(workspaceModel(arm)).map((p) => p.id);
    expect(ids.includes('agents')).toBe(CONDITIONS[arm].hasTips);
    expect(ids.includes('hooks')).toBe(CONDITIONS[arm].hasHooks);
  });
  it('gives every AGENTS.md its real number of lines', () => {
    for (const arm of ARMS) {
      const f = workspaceModel(arm).parts.find((p) => p.id === 'agents')!.form;
      if (CONDITIONS[arm].hasTips && f?.kind === 'sheet') expect(f.lines).toHaveLength(CONDITIONS[arm].agentsLines!);
    }
    expect(CONDITIONS.handwritten.agentsLines).toBe(readFileSync(resolve(root, 'arms/handwritten/AGENTS.md'), 'utf-8').trimEnd().split('\n').length);
  });
  it('wires hooks to the checks generate.py really installs', () => {
    const generate = readFileSync(resolve(root, 'src/uplift/generate.py'), 'utf-8');
    expect(generate).toContain('"sensors": (False, ["lint", "cochange", "verify"])');
    expect(generate).toContain('"both": (True, ["lint", "cochange", "verify"])');
    expect(CONDITIONS.sensors.hookChecks).toEqual(['lint', 'cochange', 'verify']);
    expect(CONDITIONS.both.hookChecks).toEqual(['lint', 'cochange', 'verify']);
    expect(CONDITIONS.tuned.hookChecks).not.toContain('cochange');
  });
  it('draws the real issue and the real diff of the selected condition, line for line', () => {
    expect(issueStrokes(task.issue)).toHaveLength(task.issue.trimEnd().split('\n').length);
    for (const arm of ARMS) {
      const diff: string = task.results[arm].runs[0].diff;
      const f = workspaceModel(arm, task).parts.find((p) => p.id === 'patch')!.form;
      const s = diffStrokes(diff);
      expect(f?.kind === 'diff' && f.lines).toEqual(s);
      expect(s).toHaveLength(diff.trimEnd().split('\n').length);
      expect(s.filter((l) => l.tone === 'add')).toHaveLength(diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length);
    }
  });
  it('lights the files the run really changed, and they exist in the tree', () => {
    const paths = new Set((tree.files as RepoFile[]).map((f) => f[0]));
    const files = changedFiles(task.results.both.runs[0].diff);
    expect(files).toContain('sqlglot/parser.py');
    const f = workspaceModel('both', task).parts.find((p) => p.id === 'snapshot')!.form;
    expect(f?.kind === 'repo' && f.lit.map((l) => l.path)).toEqual(files);
    expect(paths.has('sqlglot/parser.py')).toBe(true);
  });
  it('keeps the patch out of the model until the agent has stopped', () => {
    const p = workspaceModel('both').parts.find((x) => x.id === 'patch')!;
    expect(p.poses.map((q) => q.on)).toEqual([0, 0, 0, 0, 0, 1]);
  });
});

describe('repository treemap', () => {
  const { tiles } = repoLayout(tree.files as RepoFile[], 6.2, 4.4);
  it('places every real file exactly once, inside the plinth', () => {
    expect(tiles.map((t) => t.path).sort()).toEqual((tree.files as RepoFile[]).map((f) => f[0]).sort());
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(-3.1 - 1e-6);
      expect(t.x + t.w).toBeLessThanOrEqual(3.1 + 1e-6);
      expect(t.z).toBeGreaterThanOrEqual(-2.2 - 1e-6);
      expect(t.z + t.d).toBeLessThanOrEqual(2.2 + 1e-6);
    }
  });
  it('comes from the commit the bug started from', () => expect(tree.commit).toBe('7e7cf8b06397ed440921d079a39112e073bcfa80'));
});

describe('cutaway model', () => {
  const m = cutawayModel();
  const part = (id: string) => m.parts.find((p) => p.id === id)!;
  const hidden = m.parts.filter((p) => p.id.startsWith('hidden'));

  it('never puts a hidden test on the agent side of the barrier', () => {
    expect(hidden).toHaveLength(2);
    for (const p of hidden) for (const q of p.poses) expect(q.p[0]).toBeGreaterThan(0);
  });
  it('has the agent gone before the tests reach the workspace', () => {
    const applied = hidden[0].poses.findIndex((q, i) => i > 0 && q.p[0] !== hidden[0].poses[0].p[0]);
    expect(applied).toBeGreaterThan(0);
    expect(part('muse').poses[applied].on).toBe(0);
    expect(part('muse').poses[applied - 1].on).toBe(1);
  });
  it('moves the workspace across, not only the patch', () => {
    const last = m.views.length - 1;
    for (const id of ['snapshot', 'setup', 'patch']) {
      expect(part(id).poses[last].on).toBe(1);
      expect(part(id).poses[last].p[0]).toBeGreaterThan(0);
    }
  });
});

describe('grading model', () => {
  const m = gradingModel();
  it('has one gate per real step, in order, each explained in the text', () => {
    const gates = m.parts.filter((p) => p.id.startsWith('gate-'));
    expect(gates.map((g) => g.title)).toEqual(GRADING_STEPS.map((s) => s.title));
    expect(m.views).toHaveLength(GRADING_STEPS.length);
  });
  it('moves the run forward through the gates, and lights only the current one', () => {
    const run = m.parts.find((p) => p.id === 'run')!;
    const xs = run.poses.map((q) => q.p[0]);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    const gates = m.parts.filter((p) => p.id.startsWith('gate-'));
    GRADING_STEPS.forEach((_, at) => expect(gates.filter((g) => g.poses[at].glow).map((g) => g.id)).toEqual([`gate-${at}`]));
  });
  it('reaches a verdict only at the last step', () => {
    const v = m.parts.find((p) => p.id === 'verdict')!;
    expect(v.poses.map((q) => q.on)).toEqual(GRADING_STEPS.map((_, i) => (i === GRADING_STEPS.length - 1 ? 1 : 0)));
  });
});
