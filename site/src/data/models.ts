import { CONDITION_COLOR, INTERFACE, OUTCOME, SPECTRAL } from '../scenes/colors';
import { sheetDepth, type Form, type Light, type Link, type Model, type Part, type PartPose, type Stroke, type Vec3, type View } from '../state/assemblyStore';
import { AGENT_SEES, CONDITIONS, workspaceLayers } from './method';
import type { ArmId, Task } from './types';

// The story models, built from the same facts as the text. Nothing here invents a part: every part is a
// layer, file or step that exists in the code, and a condition only shows what it really installed.

export const WORKSPACE_STATES = ['assembled', 'exploded', 'issue', 'setup', 'running', 'patch'] as const;

/** The real issue, line by line. Without its file the sheet keeps the shape of one and carries no claim. */
export function issueStrokes(issue?: string): Stroke[] {
  if (!issue) return Array.from({ length: 15 }, (_, i) => ({ len: 0.4 + 0.3 * ((i * 7) % 5) / 4 }));
  let code = false;
  return issue.trimEnd().split('\n').map((raw, i): Stroke => {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('```')) { code = !code; return { len: 0.14, tone: 'code' }; }
    return { len: Math.min(1, line.length / 64), tone: code ? 'code' : i === 0 ? 'head' : 'plain' };
  });
}

/** The real diff, line by line, in the colours a diff is always read in. */
export function diffStrokes(diff?: string): Stroke[] {
  if (!diff) return Array.from({ length: 12 }, (_, i) => ({ len: 0.3 + 0.4 * ((i * 5) % 7) / 6 }));
  return diff.trimEnd().split('\n').map((line): Stroke => {
    const len = Math.min(1, line.length / 76);
    if (/^(diff --git|index |--- |\+\+\+ |@@)/.test(line)) return { len, tone: 'hunk' };
    if (line.startsWith('+')) return { len, tone: 'add' };
    if (line.startsWith('-')) return { len, tone: 'del' };
    return { len };
  });
}

export const changedFiles = (diff?: string): string[] => [...(diff ?? '').matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]);

/** Strokes for a document whose contents are not published: its real number of lines and nothing else. */
const blankLines = (n: number): Stroke[] => Array.from({ length: n }, (_, i) => (i === 0 ? { len: 0.5, tone: 'head' as const } : { len: 0.42 + 0.5 * (((i * 11) % 9) / 8) }));

const ASSEMBLED = 0, EXPLODED = 1, ISSUE = 2, SETUP = 3, RUNNING = 4, PATCH = 5;
const ALL = [ASSEMBLED, EXPLODED, ISSUE, SETUP, RUNNING, PATCH];
const apart = (s: number) => s === EXPLODED || s === ISSUE || s === SETUP;
const TILT: Vec3 = [0.62, 0, 0];

/** Every object of one run's workspace, on one tilted axis. Each condition shows only what it really installed. */
export function workspaceModel(arm: ArmId, task?: Task | null): Model {
  const c = CONDITIONS[arm];
  const color = CONDITION_COLOR[arm];
  const layer = (id: string) => workspaceLayers(arm).find((l) => l.id === id) ?? workspaceLayers('both').find((l) => l.id === id)!;
  const run = task?.results[arm]?.runs[0];
  const issueLines = issueStrokes(task?.issue);
  const lines = diffStrokes(run?.diff);
  const files = changedFiles(run?.diff);
  const longDoc = (c.agentsLines ?? 0) > 20;

  const part = (id: string, opts: Omit<Part, 'id' | 'title' | 'detail' | 'source'>, detail?: string): Part => {
    const l = layer(id);
    return { id, title: l.title, detail: detail ?? l.detail, source: l.source, ...opts };
  };

  const repo = part('snapshot', {
    form: { kind: 'repo', key: `repo:${files.join()}`, width: 6.2, depth: 4.4, lit: files.map((path) => ({ path, color: INTERFACE.ember, seq: 0.9 })) } as Form,
    size: [6.2, 0.5, 4.4], accent: SPECTRAL.blue,
    focus: { dist: 8.5, el: 0.72 },
    poses: ALL.map((s) => ({ p: [0, -2.7, 0], on: 1, glow: s === EXPLODED ? 0.7 : 0, reveal: s === PATCH ? 1 : 0, dim: s === ISSUE || s === SETUP ? 0.55 : 1 })),
  }, 'The real sqlglot file tree this bug started from, at commit 7e7cf8b: each block is one file, grouped by directory, larger files taking more room. A git archive of that commit, unpacked into a fresh folder.');

  const history = part('history', {
    form: { kind: 'commit', key: 'commit', color: SPECTRAL.blue }, size: [2, 0.2, 0.6], accent: SPECTRAL.blue,
    poses: ALL.map((s) => ({ p: [-3.65, -1.6, 0], on: s === EXPLODED ? 1 : 0, rot: TILT })),
  });
  const cleanup = part('cleanup', {
    form: { kind: 'ghost', key: 'ghost', width: 1.3, depth: 1.6, color: INTERFACE.text3 }, size: [1.3, 0.1, 1.6], accent: INTERFACE.text3,
    poses: ALL.map((s) => ({ p: [4.7, -2.3, 0.5], on: s === EXPLODED ? 1 : 0, rot: TILT })),
  });

  const issue = part('issue', {
    form: { kind: 'sheet', key: `issue:${issueLines.length}:${task ? 1 : 0}`, shape: 'ticket', width: 2.5, lines: issueLines, color: SPECTRAL.amber },
    size: [2.5, 0.1, sheetDepth(issueLines.length)], accent: SPECTRAL.amber,
    focus: { dist: 6.5, el: 0.62, yaw: -0.14 },
    poses: ALL.map((s) => (apart(s)
      ? { p: [-3.05, 0.05, 0], on: 1, rot: TILT, glow: s === ISSUE ? 1 : 0, dim: s === SETUP ? 0.5 : 1 }
      : { p: [-1.72, -2.3, 1.15], on: 1, scale: 0.62, glow: 0 })),
  }, 'The linked GitHub issue, inserted into the same fixed prompt for every condition. Here, the real issue of the WINDOW bug: one stroke for each of its lines.');

  const docLines = c.agentsLines ?? 13;
  const agents = part('agents', {
    form: { kind: 'sheet', key: `agents:${docLines}:${color}`, shape: 'doc', width: 2.1, lines: blankLines(docLines), color },
    size: [2.1, 0.1, sheetDepth(docLines)], accent: color,
    focus: { dist: longDoc ? 8.5 : 6.2, el: 0.62, yaw: -0.08 },
    poses: ALL.map((s) => (apart(s)
      ? { p: [-0.2, 0.05, 0], on: c.hasTips ? 1 : 0, rot: TILT, scale: longDoc ? 0.6 : 1, glow: s === SETUP ? 1 : 0, dim: s === ISSUE ? 0.5 : 1 }
      : { p: [0.2, -2.3, 1.15], on: c.hasTips ? 1 : 0, scale: longDoc ? 0.34 : 0.6, glow: 0 })),
  }, arm === 'handwritten'
    ? `${layer('agents').detail} One stroke for each of its ${docLines} lines; the full text is in the Conditions section.`
    : `${layer('agents').detail} One stroke for each of its ${docLines} lines. The text itself is not published, so these strokes show its length only.`);

  const checks = c.hookChecks ?? [];
  const delivered = run?.hooks?.length ?? 0;
  const hooks = part('hooks', {
    form: { kind: 'hooks', key: `hooks:${checks.join()}:${color}`, checks, color }, size: [3.2, 0.3, 2.4], accent: color,
    focus: { dist: 7.6, el: 0.6, yaw: 0.06 },
    poses: ALL.map((s) => (apart(s)
      ? { p: [3.05, 0.05, 0], on: c.hasHooks ? 1 : 0, rot: TILT, glow: s === SETUP ? 1 : 0, dim: s === ISSUE ? 0.5 : 1 }
      : { p: [2.1, -2.3, 1.15], on: c.hasHooks ? 1 : 0, scale: 0.5, glow: 0 })),
  }, `${layer('hooks').detail} After each edit: ${checks.filter((k) => k !== 'verify').join(' and ').replace('cochange', 'co-change')}. Before stopping: verify, which can send the agent back.${task ? ` In this run they delivered ${delivered} message${delivered === 1 ? '' : 's'}.` : ''}`);

  const core = part('agent', {
    form: { kind: 'core', key: 'core' }, size: [2.8, 2.8, 2.8], accent: SPECTRAL.core, halo: 6, inkRest: 0.14,
    focus: { dist: 7, el: 0.28 },
    poses: ALL.map((s) => (apart(s)
      ? { p: [0, 2.85, 0], on: 1, glow: s === EXPLODED ? 0.55 : 0.3, dim: s === ISSUE || s === SETUP ? 0.7 : 1 }
      : { p: [0, -1.3, -0.95], on: 1, scale: 0.6, glow: s === RUNNING ? 1 : s === PATCH ? 0.3 : 0.08 })),
  }, `${layer('agent').detail} The outer ring has forty ticks, one for each model step the run may use.`);

  const patch = part('patch', {
    form: { kind: 'diff', key: `diff:${arm}:${task ? 1 : 0}`, width: 3.3, lines }, size: [3.3, 0.14, 0.36 + lines.length * 0.07], accent: INTERFACE.ember,
    focus: { dist: 6.4, el: 0.6, yaw: -0.2 },
    poses: ALL.map((s) => ({ p: s === PATCH ? [3.55, -0.5, 0.9] : [0, -1.3, -0.95], on: s === PATCH ? 1 : 0, rot: TILT, scale: s === PATCH ? 1 : 0.3, glow: s === PATCH ? 1 : 0 })),
  }, `${layer('patch').detail}${task ? ' Here, the real diff of this condition\'s first run on the WINDOW bug: one stroke per line, green added, red removed. The files it touched are lit on the repository.' : ''}`);

  const spine: Part = {
    id: 'spine', title: 'Axis', detail: '', inert: true, form: { kind: 'spine', key: 'spine', height: 5.4 }, size: [0.1, 5.4, 0.1], accent: SPECTRAL.violet,
    poses: ALL.map((s) => ({ p: [0, 0, -0.1], on: apart(s) ? 1 : 0 })),
  };

  const feed = (to: string, on: number[]): Link => ({ from: 'agent', to, accent: SPECTRAL.amber, on });
  const links: Link[] = [
    feed('snapshot', [0, 0, 0, 0, 1, 0]), feed('issue', [0, 0, 0, 0, 1, 0]), feed('agents', [0, 0, 0, 0, 1, 0]), feed('hooks', [0, 0, 0, 0, 1, 0]),
    { from: 'agent', to: 'patch', accent: INTERFACE.ember, on: [0, 0, 0, 0, 0, 1] },
  ];
  const views: View[] = [
    { target: [0, -2, 0], dist: 11.2, yaw: -0.62, el: 0.56 },
    { target: [0, -0.15, 0], dist: 13, yaw: -0.3, el: 0.3 },
    { target: [-1.5, -0.3, 0], dist: 10.8, yaw: -0.2, el: 0.36 },
    { target: [1.4, -0.3, 0], dist: 10.8, yaw: 0.12, el: 0.36 },
    { target: [0, -1.9, 0], dist: 10.4, yaw: 0.46, el: 0.42 },
    { target: [1.6, -1.5, 0], dist: 11.6, yaw: -0.3, el: 0.46 },
  ];
  const lights: Light[] = ALL.map((s) => ({
    p: apart(s) ? [0, 2.85, 0.6] : [0, -0.4, -0.5],
    warm: s === RUNNING ? 1.15 : apart(s) ? 1.1 : 0.5,
    cool: s === RUNNING ? 0.2 : 0.42,
  }));
  return {
    parts: [repo, history, cleanup, issue, agents, hooks, core, patch, spine], links, views, lights,
    steps: [['snapshot', 'agent'], ['snapshot', 'history', 'cleanup'], ['issue'], ['agents', 'hooks'], ['agent'], ['patch', 'snapshot']],
  };
}

const OUTCOME_ACCENT = { pass: OUTCOME.solved, keep: OUTCOME.mixed };

export const CUTAWAY_STATES = ['agent-input', 'hidden', 'patch', 'prepare', 'run', 'result'] as const;

/**
 * The information barrier, as a conceptual cutaway. The real separation is one of timing: hidden tests
 * reach the workspace only after the agent has exited. So the workspace crosses to the evaluator's side
 * once the agent is gone, and the tests never appear on the agent's side at all.
 */
export function cutawayModel(): Model {
  const six = <T,>(v: (i: number) => T): T[] => [0, 1, 2, 3, 4, 5].map(v);
  const place = (from: number, p: Vec3, opts: { until?: number; glowAt?: number[]; moved?: { at: number; p: Vec3 } } = {}): PartPose[] => six((i) => ({
    p: opts.moved && i >= opts.moved.at ? opts.moved.p : p,
    on: i >= from && i <= (opts.until ?? 5) ? 1 : 0,
    glow: opts.glowAt?.includes(i) ? 1 : 0,
  }));
  const sees = (k: string) => AGENT_SEES.find((x) => x.k === k)?.v ?? '';
  const parts: Part[] = [
    { id: 'barrier', title: 'Information barrier', detail: 'A conceptual wall. The real separation is timing: hidden tests reach the workspace only after the agent has exited.', source: 'src/uplift/runner.py', shape: 'wall', glass: true, size: [0.1, 3.6, 4.6], accent: SPECTRAL.violet, poses: place(0, [0, 0.1, 0], { glowAt: [1] }) },
    { id: 'agent-floor', title: 'Agent side', detail: 'What exists while the agent runs.', size: [5.8, 0.14, 4.4], accent: SPECTRAL.blue, poses: place(0, [-3.2, -1.7, 0]) },
    { id: 'eval-floor', title: 'Evaluator side', detail: 'What exists only after the agent has exited.', size: [5.8, 0.14, 4.4], accent: SPECTRAL.cyan, poses: place(0, [3.2, -1.7, 0]) },
    { id: 'snapshot', title: 'Repository snapshot', detail: sees('Repository snapshot'), source: 'src/uplift/workspace.py', size: [3.2, 0.2, 2.6], accent: SPECTRAL.blue, poses: place(0, [-3.4, -1.45, 0.2], { moved: { at: 3, p: [3.2, -1.45, 0.2] }, glowAt: [0, 3] }) },
    { id: 'setup', title: 'Installed setup', detail: sees('Assigned setup'), source: 'src/uplift/workspace.py', size: [3.2, 0.14, 2.6], accent: SPECTRAL.magenta, poses: place(0, [-3.4, -1.2, 0.2], { moved: { at: 3, p: [3.2, -1.2, 0.2] }, glowAt: [0] }) },
    { id: 'issue', title: 'Task issue', detail: sees('Task issue'), source: 'src/uplift/runner.py', size: [1.5, 0.12, 1.1], accent: SPECTRAL.amber, poses: place(0, [-4.9, 0.4, -0.9], { until: 2, glowAt: [0] }) },
    { id: 'muse', title: 'Muse Code', detail: 'The agent under test. It works with the issue, the code and its setup, and it has exited before anything on the other side begins.', source: 'src/uplift/runner.py', shape: 'column', size: [0.9, 1.7, 0.9], accent: SPECTRAL.core, poses: place(0, [-3.4, -0.1, 0.2], { until: 2, glowAt: [0, 2] }) },
    { id: 'patch', title: 'Produced patch', detail: 'The diff of the agent\'s changes, excluding agent files. It is recorded when the agent stops. Grading then uses the workspace itself, as the agent left it.', source: 'src/uplift/workspace.py', size: [2.4, 0.1, 1.9], accent: INTERFACE.ember, poses: place(2, [-3.4, -0.98, 0.2], { moved: { at: 3, p: [3.2, -0.98, 0.2] }, glowAt: [2] }) },
    { id: 'hidden-f2p', title: 'FAIL_TO_PASS tests', detail: 'The bug\'s own tests from the real fix. They fail before it and must pass after it.', source: 'src/uplift/grade.py', size: [1.5, 0.3, 1.1], accent: OUTCOME_ACCENT.pass, poses: place(1, [1.9, 1, -0.9], { moved: { at: 3, p: [2.4, -0.62, 0.2] }, glowAt: [1, 3] }) },
    { id: 'hidden-p2p', title: 'PASS_TO_PASS tests', detail: 'Existing tests that must still pass, so a fix cannot break what worked.', source: 'src/uplift/grade.py', size: [1.5, 0.3, 1.1], accent: OUTCOME_ACCENT.keep, poses: place(1, [4.5, 1, -0.9], { moved: { at: 3, p: [4, -0.62, 0.2] }, glowAt: [1, 3] }) },
    { id: 'pytest', title: 'Pytest', detail: 'The tests run with the workspace\'s own interpreter and an isolated config.', source: 'src/uplift/grade.py', shape: 'column', size: [0.8, 1.5, 0.8], accent: SPECTRAL.cyan, poses: place(4, [3.2, 0.4, 0.2], { glowAt: [4] }) },
    { id: 'verdict', title: 'Result', detail: 'Resolved or not resolved. Nothing else is scored, and the agent never learns which.', source: 'src/uplift/screen.py', size: [2.2, 0.2, 1.3], accent: INTERFACE.ember, poses: place(5, [3.2, 1.5, 0.2], { glowAt: [5] }) },
  ];
  const near: Vec3 = [-1.2, 0, 0], far: Vec3 = [1.2, 0, 0];
  return {
    parts,
    links: [
      { from: 'muse', to: 'patch', accent: INTERFACE.ember, on: [0, 0, 1, 0, 0, 0] },
      { from: 'pytest', to: 'verdict', accent: INTERFACE.ember, on: [0, 0, 0, 0, 0, 1] },
    ],
    views: [
      { target: near, dist: 14, yaw: -0.34, el: 0.34 },
      { target: [0, 0, 0], dist: 15.5, yaw: 0.1, el: 0.32 },
      { target: near, dist: 14, yaw: -0.3, el: 0.3 },
      { target: [0.6, 0, 0], dist: 15, yaw: 0.16, el: 0.34 },
      { target: far, dist: 13, yaw: 0.34, el: 0.3 },
      { target: far, dist: 13, yaw: 0.28, el: 0.26 },
    ],
  };
}

