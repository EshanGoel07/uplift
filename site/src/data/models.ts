import { CONDITION_COLOR, INTERFACE, OUTCOME, SPECTRAL } from '../scenes/colors';
import { sheetDepth, type Form, type Light, type Link, type Model, type Part, type PartPose, type Stroke, type Vec3, type View } from '../state/assemblyStore';
import { AGENT_SEES, CONDITIONS, NETWORK_NOTE, workspaceLayers } from './method';
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

export const CUTAWAY_STATES = ['received', 'working', 'exit', 'hidden', 'grading', 'result'] as const;

/** On the time rail: start, agent exits, tests applied, grading, result. */
const TICKS = [-5, -2.6, 0, 2.6, 5];
const RAIL: Vec3 = [0, -2.72, 3.5];
const REPO_AT: Vec3 = [-1.2, -1.72, 0.3];
const REPO_SCALE = 0.8;
/** Where tests/test_parser.py, the file the WINDOW bug's real fix tests, sits on the repository. */
export const TEST_FILE_TILE: [number, number] = [-0.624, 0.977];
export const CUTAWAY_ROOM = { width: 12, depth: 6.4, height: 4.6 };

/**
 * One workspace from beginning to end. The separation is timing, so there is no wall: the hidden tests sit on
 * the time rail at their own moment, and reach the room only after the agent has exited. Everything in the
 * workspace keeps its place in every state, because grading happens in the workspace the agent left.
 */
export function cutawayModel(arm: ArmId = 'both', task?: Task | null): Model {
  const STATES = [0, 1, 2, 3, 4, 5];
  const [RECEIVED, WORKING, EXIT, HIDDEN, GRADING, RESULT] = STATES;
  const c = CONDITIONS[arm];
  const color = CONDITION_COLOR[arm];
  const run = task?.results[arm]?.runs[0];
  const files = changedFiles(run?.diff);
  const sees = (k: string) => AGENT_SEES.find((x) => x.k === k)?.v ?? '';
  const fixed = (p: Vec3, pose: (s: number) => Partial<PartPose> = () => ({})): PartPose[] => STATES.map((s) => ({ p, on: 1, ...pose(s) }));
  const WALL: Vec3 = [Math.PI / 2, 0, 0];
  const docLines = c.agentsLines ?? 13;
  const issueLines = issueStrokes(task?.issue);
  const after = (s: number, at: number) => (s >= at ? 1 : 0);
  const quietLater = (s: number) => (s >= HIDDEN ? 0.5 : 1);
  const test: Vec3 = [REPO_AT[0] + TEST_FILE_TILE[0] * REPO_SCALE, REPO_AT[1] + 0.34, REPO_AT[2] + TEST_FILE_TILE[1] * REPO_SCALE];

  const parts: Part[] = [
    { id: 'room', title: 'The workspace', detail: '', inert: true, form: { kind: 'room', key: 'room', ...CUTAWAY_ROOM }, size: [12, 4.6, 6.4], accent: SPECTRAL.blue, poses: fixed([0, -1.9, 0]) },
    {
      id: 'timeline', title: 'Timeline', detail: 'Time, left to right: the run starts, the agent exits, the hidden tests are applied, grading runs, the result is recorded. The separation between agent and evaluator is this order, not a wall.', source: 'src/uplift/runner.py',
      form: { kind: 'rail', key: 'rail', ticks: TICKS, split: TICKS[1] }, size: [11, 0.2, 0.3], accent: SPECTRAL.violet, focus: { dist: 10, el: 0.36, yaw: 0 }, poses: fixed(RAIL),
    },
    { id: 'playhead', title: 'Now', detail: '', inert: true, form: { kind: 'marker', key: 'marker' }, size: [0.3, 0.5, 0.3], accent: INTERFACE.ember, poses: STATES.map((s) => ({ p: [TICKS[Math.max(0, s - 1)] + (s === RECEIVED ? -0.3 : s === WORKING ? 1.2 : 0), RAIL[1] + 0.34, RAIL[2]], on: 1, glow: 1 })) },
    {
      id: 'snapshot', title: 'Repository snapshot', detail: `${sees('Repository snapshot')} It stays in this one workspace from start to finish.`, source: 'src/uplift/workspace.py',
      form: { kind: 'repo', key: `cut-repo:${files.join()}`, width: 6.2, depth: 4.4, scan: true, lit: [...files.map((path) => ({ path, color: INTERFACE.ember, seq: 0.3 })), { path: 'tests/test_parser.py', color: OUTCOME.solved, seq: 0.6 }] } as Form,
      size: [5, 0.5, 3.5], accent: SPECTRAL.blue, focus: { dist: 8, el: 0.66 },
      poses: fixed(REPO_AT, (s) => ({ scale: REPO_SCALE, reveal: s >= GRADING ? 1 : s === HIDDEN ? 0.7 : s === EXIT ? 0.35 : 0, glow: s === RECEIVED ? 0.5 : 0 })),
    },
    {
      id: 'issue', title: 'Task issue', detail: sees('Task issue'), source: 'src/uplift/runner.py',
      form: { kind: 'sheet', key: `cut-issue:${issueLines.length}:${task ? 1 : 0}`, shape: 'ticket', width: 2.5, lines: issueLines, color: SPECTRAL.amber },
      size: [2.5, 0.1, sheetDepth(issueLines.length)], accent: SPECTRAL.amber, focus: { dist: 6.6, el: 0.1, yaw: 0 },
      poses: fixed([-4.1, 1.05, -2.72], (s) => ({ rot: WALL, scale: 0.86, dim: quietLater(s), glow: s === RECEIVED ? 0.6 : 0 })),
    },
    {
      id: 'agents', title: 'AGENTS.md', detail: `${sees('Assigned setup')} ${docLines} lines in this condition; it stays where it was installed.`, source: 'src/uplift/workspace.py',
      form: { kind: 'sheet', key: `cut-agents:${docLines}:${color}`, shape: 'doc', width: 2.1, lines: blankLines(docLines), color },
      size: [2.1, 0.1, sheetDepth(docLines)], accent: color, focus: { dist: 6.6, el: 0.1, yaw: 0 },
      poses: fixed([1.5, 1.05, -2.72], (s) => ({ on: c.hasTips ? 1 : 0, rot: WALL, scale: (c.agentsLines ?? 0) > 20 ? 0.56 : 0.86, dim: quietLater(s), glow: s === RECEIVED ? 0.6 : 0 })),
    },
    {
      id: 'hooks', title: 'Hook configuration', detail: `${sees('Runtime feedback')} They run only while the agent works.`, source: 'src/uplift/arm_hooks/uplift_hook.py',
      form: { kind: 'hooks', key: `cut-hooks:${(c.hookChecks ?? []).join()}:${color}`, checks: c.hookChecks ?? [], color }, size: [3.2, 0.3, 2.4], accent: color, focus: { dist: 7, el: 0.1, yaw: 0 },
      poses: fixed([3.95, 1.05, -2.72], (s) => ({ on: c.hasHooks ? 1 : 0, rot: WALL, scale: 0.72, dim: quietLater(s), glow: s === RECEIVED ? 0.6 : 0 })),
    },
    {
      id: 'muse', title: 'Muse Code', detail: 'The agent under test. It works in this workspace, and when it exits it is gone: nothing here can reach it again.', source: 'src/uplift/runner.py',
      form: { kind: 'core', key: 'core' }, size: [2.8, 2.8, 2.8], accent: SPECTRAL.core, halo: 6, inkRest: 0.1, focus: { dist: 6.6, el: 0.3 },
      poses: fixed([-1.2, 0.72, 0.3], (s) => ({ scale: 0.72, glow: s === WORKING ? 1 : s === RECEIVED ? 0.3 : 0, rot: s >= EXIT ? [0.5, 0, 0.4] : [0, 0, 0], dim: s >= EXIT ? 0.6 : 1 })),
    },
    {
      id: 'patch', title: 'Produced patch', detail: 'The diff of the agent\'s changes, excluding agent files, recorded when the agent stops. Grading then uses the workspace itself, as the agent left it.', source: 'src/uplift/workspace.py',
      form: { kind: 'diff', key: `cut-diff:${arm}:${task ? 1 : 0}`, width: 3.3, lines: diffStrokes(run?.diff) }, size: [3.3, 0.14, 2.8], accent: INTERFACE.ember, focus: { dist: 6.4, el: 0.7 },
      poses: fixed([3.75, -1.62, 0.9], (s) => ({ on: after(s, EXIT), scale: 0.72, glow: s === EXIT ? 1 : 0, rot: [0.16, -0.2, 0], dim: s > EXIT ? 0.65 : 1 })),
    },
    {
      id: 'hidden', title: 'Hidden tests', detail: `The real fix's test patch. It is not in the workspace while the agent runs, and it is applied only after the agent has exited. For the WINDOW bug the real fix's tests are in tests/test_parser.py. ${NETWORK_NOTE}`, source: 'src/uplift/grade.py',
      form: { kind: 'sealed', key: 'sealed', color: OUTCOME.solved }, size: [1.5, 0.34, 1.1], accent: OUTCOME.solved, focus: { dist: 6.4, el: 0.42 },
      poses: STATES.map((s) => (s < HIDDEN
        ? { p: [TICKS[2], RAIL[1] + 0.34, RAIL[2]], on: 1, glow: s === WORKING ? 0.6 : 0.2, reveal: 0, dim: s === EXIT ? 0.8 : 1 }
        : { p: test, on: 1, scale: 0.5, reveal: 1, glow: s === HIDDEN ? 1 : 0.3 })),
    },
    {
      id: 'pytest', title: 'Pytest', detail: 'The tests run in this workspace, with its own interpreter and an isolated config. The next section takes this step apart.', source: 'src/uplift/grade.py',
      form: { kind: 'scan', key: 'scan', depth: 3.8 }, size: [0.4, 0.2, 3.8], accent: SPECTRAL.cyan, focus: { dist: 8.5, el: 0.6 },
      poses: STATES.map((s) => ({ p: [s >= GRADING ? 1.45 : -3.8, -1.4, 0.3], on: s === GRADING ? 1 : 0, glow: 1 })),
    },
    {
      id: 'verdict', title: 'Result', detail: `Resolved or not resolved. Nothing else is scored, and the agent never learns which.${run ? ` This run: ${run.resolved ? 'resolved' : 'not resolved'}, from the published record of the WINDOW bug.` : ''}`, source: 'src/uplift/screen.py',
      form: { kind: 'seal', key: `seal:${run ? run.resolved : 'none'}`, outcome: run ? (run.resolved ? 'resolved' : 'unresolved') : 'unknown' }, size: [1.6, 0.2, 1.6], accent: run && !run.resolved ? OUTCOME.failed : OUTCOME.solved, focus: { dist: 6, el: 0.2, yaw: 0 },
      poses: fixed([3.75, -0.25, 1.1], (s) => ({ on: s === RESULT ? 1 : 0, rot: [1.15, 0, 0], scale: 0.9, glow: 1 })),
    },
  ];

  const feed = (to: string): Link => ({ from: 'muse', to, accent: SPECTRAL.amber, on: [0, 1, 0, 0, 0, 0] });
  const views: View[] = [
    { target: [0, -0.5, 0], dist: 15.2, yaw: -0.3, el: 0.26 },
    { target: [0, -0.5, 0.4], dist: 15, yaw: -0.16, el: 0.24 },
    { target: [0, -0.6, 0.6], dist: 15, yaw: 0.1, el: 0.26 },
    { target: [0, -0.8, 1], dist: 14.6, yaw: 0.14, el: 0.36 },
    { target: [0, -0.9, 0.4], dist: 14.6, yaw: 0.02, el: 0.42 },
    { target: [0, -0.6, 0.4], dist: 15, yaw: -0.08, el: 0.3 },
  ];
  const lights: Light[] = STATES.map((s) => (s <= WORKING
    ? { p: [-1.2, 1.1, 1], warm: s === WORKING ? 1.25 : 0.7, cool: 0.2 }
    : s === EXIT ? { p: [-1.2, 1.1, 1], warm: 0.18, cool: 0.34 } : { p: [0, 2.2, 2], warm: 0.32, cool: 1 }));
  return {
    parts, views, lights,
    links: [feed('snapshot'), feed('issue'), feed('agents'), feed('hooks')],
    steps: [['snapshot', 'issue', 'agents', 'hooks'], ['muse', 'hidden'], ['muse', 'patch'], ['hidden', 'timeline'], ['pytest'], ['verdict']],
  };
}
