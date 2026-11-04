import { CONDITION_COLOR, INTERFACE, OUTCOME, SPECTRAL } from '../scenes/colors';
import type { Model, Part, PartPose, Vec3 } from '../state/assemblyStore';
import { AGENT_SEES, workspaceLayers } from './method';
import type { ArmId } from './types';

// The story models, built from the same facts as the text. Nothing here invents a part: every part is a
// layer, file or step that exists in the code, and a condition only shows what it really installed.

export const WORKSPACE_STATES = ['snapshot', 'issue', 'setup', 'assembled', 'patch'] as const;

const SLAB: Vec3 = [5.2, 0.2, 3.4];
const OUTCOME_ACCENT = { pass: OUTCOME.solved, keep: OUTCOME.mixed };
const ACCENT: Record<string, string> = { base: SPECTRAL.blue, issue: SPECTRAL.amber, agent: SPECTRAL.core, output: INTERFACE.ember };

/** The layers of one run's workspace, which rise into a stack as the story introduces them. */
export function workspaceModel(arm: ArmId): Model {
  const layers = workspaceLayers(arm);
  const n = layers.length;
  const tight = 0.27, open = 0.74;
  const stackY = (i: number, pitch: number) => (i - (n - 1) / 2) * pitch;
  const appears = (id: string, kind: string): number => {
    if (['snapshot', 'history', 'cleanup'].includes(id)) return 0;
    if (id === 'issue') return 1;
    if (kind === 'setup') return 2;
    if (id === 'agent') return 3;
    return 4;
  };
  const parts: Part[] = layers.map((l, i) => {
    const first = appears(l.id, l.kind);
    const accent = l.kind === 'setup' ? CONDITION_COLOR[arm] : l.id === 'issue' ? ACCENT.issue : l.id === 'agent' ? ACCENT.agent : l.kind === 'output' ? ACCENT.output : ACCENT.base;
    const poses: PartPose[] = [0, 1, 2, 3, 4].map((s) => {
      const present = s >= first;
      const pitch = s === 3 ? tight : open;
      const y = stackY(i, pitch);
      if (!present) return { p: [0, y + 2.2, 0], on: 0 };
      if (l.id === 'patch') return { p: [2.9, y - 0.2, 0.5], on: 1, glow: 1 };
      return { p: [s === 4 ? -0.8 : 0, y, 0], on: 1, glow: s === first ? 1 : l.id === 'agent' && s === 3 ? 1 : 0 };
    });
    return { id: l.id, title: l.title, detail: l.detail, source: l.source, size: l.id === 'patch' ? [3, 0.2, 2] : SLAB, accent, poses };
  });
  return {
    parts,
    links: [{ from: 'agent', to: 'patch', accent: INTERFACE.ember, on: [0, 0, 0, 0, 1] }],
    views: [
      { target: [0, 0, 0], dist: 13, yaw: -0.62, el: 0.46 },
      { target: [0, 0.2, 0], dist: 13, yaw: -0.5, el: 0.42 },
      { target: [0, 0.4, 0], dist: 13.5, yaw: -0.36, el: 0.36 },
      { target: [0, 0, 0], dist: 12, yaw: -0.7, el: 0.5 },
      { target: [0.6, 0, 0], dist: 15, yaw: -0.3, el: 0.26 },
    ],
  };
}

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

