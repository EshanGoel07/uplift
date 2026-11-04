// The story models must say what the code says. They are data, so the claims can be checked directly.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { changedFiles, CUTAWAY_ROOM, CUTAWAY_STATES, cutawayModel, diffStrokes, issueStrokes, TEST_FILE_TILE, workspaceModel } from '../../src/data/models';
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
  const m = cutawayModel('both', task);
  const part = (id: string) => m.parts.find((p) => p.id === id)!;
  const HIDDEN = CUTAWAY_STATES.indexOf('hidden'), EXIT = CUTAWAY_STATES.indexOf('exit');
  const inRoom = (p: number[]) => Math.abs(p[0]) <= CUTAWAY_ROOM.width / 2 && Math.abs(p[2]) <= CUTAWAY_ROOM.depth / 2;

  it('is one workspace: nothing in it ever moves, in any state', () => {
    for (const id of ['room', 'snapshot', 'issue', 'agents', 'hooks', 'muse', 'patch']) {
      const at = part(id).poses.map((q) => q.p.join());
      expect(new Set(at).size, id).toBe(1);
    }
  });
  it('has no wall, barrier or second side', () => {
    expect(m.parts.map((p) => p.id).join()).not.toMatch(/barrier|wall|floor|side/);
    expect(m.parts.some((p) => p.shape === 'wall')).toBe(false);
  });
  it('keeps the hidden tests out of the workspace until after the agent has exited', () => {
    const h = part('hidden');
    h.poses.forEach((q, s) => expect(inRoom(q.p), `state ${s}`).toBe(s >= HIDDEN));
    expect(HIDDEN).toBeGreaterThan(EXIT);
  });
  it('has the agent inactive from its exit on, and active before', () => {
    const glow = part('muse').poses.map((q) => q.glow ?? 0);
    expect(glow[CUTAWAY_STATES.indexOf('working')]).toBe(1);
    glow.slice(EXIT).forEach((g) => expect(g).toBe(0));
    for (let i = EXIT; i < glow.length; i++) for (const l of m.links) if (l.from === 'muse' && i > EXIT) expect(l.on[i]).toBe(0);
  });
  it('lands the tests on the file the real fix tests', () => {
    const t = repoLayout(tree.files as RepoFile[], 6.2, 4.4).tiles.find((x) => x.path === 'tests/test_parser.py')!;
    expect(TEST_FILE_TILE[0]).toBeCloseTo(t.x + t.w / 2, 2);
    expect(TEST_FILE_TILE[1]).toBeCloseTo(t.z + t.d / 2, 2);
  });
  it('records the patch at the exit, and a result only at the end, from the published run', () => {
    expect(part('patch').poses.map((q) => q.on)).toEqual([0, 0, 1, 1, 1, 1]);
    expect(part('verdict').poses.map((q) => q.on)).toEqual([0, 0, 0, 0, 0, 1]);
    for (const arm of ARMS) {
      const f = cutawayModel(arm, task).parts.find((p) => p.id === 'verdict')!.form;
      expect(f?.kind === 'seal' && f.outcome).toBe(task.results[arm].runs[0].resolved ? 'resolved' : 'unresolved');
    }
  });
  it.each(ARMS)('%s installs only its own artifacts', (arm) => {
    const c = cutawayModel(arm);
    const on = (id: string) => c.parts.find((p) => p.id === id)!.poses.some((q) => q.on > 0.5);
    expect(on('agents')).toBe(CONDITIONS[arm].hasTips);
    expect(on('hooks')).toBe(CONDITIONS[arm].hasHooks);
  });
  it('moves time forward only', () => {
    const xs = part('playhead').poses.map((q) => q.p[0]);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
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
