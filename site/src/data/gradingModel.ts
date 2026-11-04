import { INTERFACE, OUTCOME, SPECTRAL } from '../scenes/colors';
import type { Model, Part, PartPose } from '../state/assemblyStore';
import { GRADING_STEPS, RESOLVED_RULE } from './method';

/** One state per grading step, in the order grade.py runs them. */
export const GRADING_STATES = GRADING_STEPS.map((s) => s.title.toLowerCase().replace(/[^a-z]+/g, '-'));

const SOURCES = ['src/uplift/runner.py', 'src/uplift/grade.py', 'src/uplift/grade.py', 'src/uplift/grade.py', 'src/uplift/grade.py', 'src/uplift/grade.py', 'src/uplift/grade.py', 'src/uplift/grade.py', 'src/uplift/screen.py'];
const PITCH = 1.12;
const gateX = (i: number) => (i - (GRADING_STEPS.length - 1) / 2) * PITCH;

/**
 * The grader as an instrument: a line of gates, one for each real step, with the run's workspace passing
 * through them in order. A gate lights only while its step is active.
 * This shows the order of one grading, not a recording of it.
 */
export function gradingModel(): Model {
  const n = GRADING_STEPS.length;
  const states = GRADING_STEPS.map((_, i) => i);
  const gates: Part[] = GRADING_STEPS.map((s, i) => ({
    id: `gate-${i}`,
    title: s.title,
    detail: s.detail,
    source: SOURCES[i],
    shape: 'wall',
    glass: true,
    size: [0.08, 2.2, 2.2],
    accent: i === n - 1 ? INTERFACE.ember : SPECTRAL.cyan,
    poses: states.map((at): PartPose => ({ p: [gateX(i), 0.1, 0], on: 1, glow: at === i ? 1 : 0 })),
  }));
  const run: Part = {
    id: 'run',
    title: 'The run\'s workspace',
    detail: 'The agent\'s workspace, as it left it. It meets each step in turn.',
    source: 'src/uplift/runner.py',
    size: [0.82, 0.24, 1.3],
    accent: SPECTRAL.amber,
    poses: states.map((at): PartPose => ({ p: [gateX(at) - 0.56, -0.92, 0], on: 1, glow: 1 })),
  };
  const rail: Part = {
    id: 'rail',
    title: 'One fixed order',
    detail: 'Every run in every condition went through the same steps in the same order.',
    source: 'src/uplift/grade.py',
    size: [PITCH * n + 1.2, 0.12, 2.6],
    accent: SPECTRAL.blue,
    poses: states.map((): PartPose => ({ p: [0, -1.2, 0], on: 1 })),
  };
  const verdict: Part = {
    id: 'verdict',
    title: 'Verdict',
    detail: RESOLVED_RULE,
    source: 'src/uplift/screen.py',
    size: [1.2, 0.2, 1.2],
    accent: OUTCOME.solved,
    poses: states.map((at): PartPose => ({ p: [gateX(n - 1), 1.75, 0], on: at === n - 1 ? 1 : 0, glow: 1 })),
  };
  return {
    parts: [rail, ...gates, run, verdict],
    links: [],
    views: states.map((at) => ({ target: [gateX(at) * 0.12, 0.1, 0], dist: 17, yaw: -0.42 + (at / (n - 1)) * 0.16, el: 0.3 })),
  };
}
