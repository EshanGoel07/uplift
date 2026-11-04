import { INTERFACE, OUTCOME, SPECTRAL } from '../scenes/colors';
import type { Light, Model, Part, PartPose, Vec3, View } from '../state/assemblyStore';
import { GRADING_STEPS, RESOLVED_RULE } from './method';

/** One state before the first step, then one per grading step, in the order the code runs them. */
export const GRADING_STATES = ['overview', ...GRADING_STEPS.map((s) => s.title.toLowerCase().replace(/[^a-z]+/g, '-'))];

/** A stage line, because per-test results are not published and these cells stand for no real run. */
export const GRADING_CAPTION = 'Test cells are illustrative. Per-test results are not published.';

const [, RUN_DONE, RESET, APPLY, CLEAR, PYTEST, PARSE, CHECK, LISTS, VERDICT] = GRADING_STATES.map((_, i) => i);
const STATES = GRADING_STATES.map((_, i) => i);
const TOP = 3.5, MID = 0, LOW = -3.5;
const source = (step: number) => { const s = GRADING_STEPS[step].source; return `${s.file}:${s.start}`; };

/**
 * The grader as an instrument of three decks, read downward: prepare the workspace, run and read the tests,
 * then decide. Each operation has its own form, because each does a different thing. Nothing here is a
 * recording: it shows the order and the kind of each step, not any one run's results.
 */
export function gradingModel(): Model {
  const pose = (p: Vec3, f: (s: number) => Partial<PartPose> = () => ({})): PartPose[] => STATES.map((s) => ({ p, on: 1, ...f(s) }));
  const step = (i: number) => ({ title: GRADING_STEPS[i - 1].title, detail: GRADING_STEPS[i - 1].detail, source: source(i - 1) });
  const quiet = (s: number, ...at: number[]) => (s === 0 || at.includes(s) ? 1 : 0.62);
  const lit = (s: number, ...at: number[]) => (at.includes(s) ? 1 : 0);
  const deck = (id: string, y: number): Part => ({ id, title: 'Deck', detail: '', inert: true, form: { kind: 'deck', key: 'deck', width: 9.8, depth: 4.2 }, size: [9.8, 0.14, 4.2], accent: SPECTRAL.blue, poses: pose([0, y - 0.3, 0]) });
  const f2pAt = (s: number): Vec3 => (s >= LISTS ? [-1.15, LOW + 0.02, 0] : [-2.5, MID + 0.02, 0]);
  const p2pAt = (s: number): Vec3 => (s >= LISTS ? [1.2, LOW + 0.02, 0] : [-0.2, MID + 0.02, 0]);

  const parts: Part[] = [
    deck('deck-prepare', TOP), deck('deck-run', MID), deck('deck-decide', LOW),
    { id: 'link-a', title: 'Link', detail: '', inert: true, form: { kind: 'spine', key: 'link', height: 3.4 }, size: [0.1, 3.4, 0.1], accent: SPECTRAL.violet, poses: pose([-4.6, 1.45, -1.8]) },
    { id: 'link-b', title: 'Link', detail: '', inert: true, form: { kind: 'spine', key: 'link', height: 3.4 }, size: [0.1, 3.4, 0.1], accent: SPECTRAL.violet, poses: pose([4.6, -2.05, -1.8]) },
    {
      id: 'record', ...step(RUN_DONE), form: { kind: 'record', key: 'record' }, size: [2, 0.5, 1.4], accent: SPECTRAL.amber,
      poses: pose([-3.5, TOP, 0.2], (s) => ({ reveal: s >= RUN_DONE ? 1 : 0, glow: lit(s, RUN_DONE), dim: quiet(s, RUN_DONE) })),
    },
    {
      id: 'stack', title: GRADING_STEPS[1].title, detail: GRADING_STEPS[1].detail, source: source(1), form: { kind: 'stack', key: 'stack' }, size: [2.4, 0.5, 1.7], accent: SPECTRAL.blue,
      poses: pose([0, TOP, 0.2], (s) => ({ reveal: s >= RESET ? 1 : 0, glow: lit(s, RESET, APPLY), dim: quiet(s, RESET, APPLY) })),
    },
    {
      id: 'hidden', ...step(APPLY), form: { kind: 'sealed', key: 'sealed', color: OUTCOME.solved }, size: [1.5, 0.34, 1.1], accent: OUTCOME.solved,
      poses: STATES.map((s) => ({ p: s >= APPLY ? [0, TOP + 0.5, 0.2] : [0, TOP + 1.75, 0.2], on: 1, reveal: s >= APPLY ? 1 : 0, glow: lit(s, APPLY), dim: quiet(s, APPLY) })),
    },
    {
      id: 'bytecode', ...step(CLEAR), form: { kind: 'bytecode', key: 'bytecode' }, size: [3.2, 0.5, 1.8], accent: SPECTRAL.violet,
      poses: pose([3.3, TOP, 0.2], (s) => ({ reveal: s >= CLEAR ? 1 : 0, glow: lit(s, CLEAR), dim: quiet(s, CLEAR) })),
    },
    {
      id: 'pytest', ...step(PYTEST), form: { kind: 'limit', key: 'limit', radius: 2.72 }, size: [5.4, 0.1, 5.4], accent: SPECTRAL.cyan, focus: { dist: 10 },
      poses: pose([-1.2, MID - 0.14, 0], (s) => ({ glow: lit(s, PYTEST), dim: quiet(s, PYTEST), reveal: s >= PYTEST ? 1 : 0 })),
    },
    { id: 'beam', title: 'Pytest position', detail: '', inert: true, form: { kind: 'scan', key: 'beam', depth: 3 }, size: [0.2, 0.1, 3], accent: SPECTRAL.cyan, poses: STATES.map((s) => ({ p: [s >= PYTEST ? 1.15 : -3.5, MID + 0.28, 0], on: s === PYTEST ? 1 : 0, glow: 1 })) },
    {
      id: 'cells-f2p', title: 'FAIL_TO_PASS tests', detail: 'The bug\'s own tests from the real fix. They failed before it, and every one must now pass. Cells here are illustrative.', source: source(7),
      form: { kind: 'cells', key: 'f2p', rows: 4, cols: 3, color: OUTCOME.solved }, size: [1, 0.3, 1.2], accent: OUTCOME.solved,
      poses: STATES.map((s) => ({ p: f2pAt(s), on: 1, reveal: s >= PARSE ? 1 : s === PYTEST ? 0.5 : 0, glow: lit(s, LISTS), dim: quiet(s, PYTEST, PARSE, LISTS, VERDICT) })),
    },
    {
      id: 'cells-p2p', title: 'PASS_TO_PASS tests', detail: 'Existing tests that passed before and must still pass, so a fix cannot break what worked. Cells here are illustrative.', source: source(7),
      form: { kind: 'cells', key: 'p2p', rows: 8, cols: 7, color: OUTCOME.mixed }, size: [2, 0.3, 2.2], accent: OUTCOME.mixed,
      poses: STATES.map((s) => ({ p: p2pAt(s), on: 1, reveal: s >= PARSE ? 1 : s === PYTEST ? 0.5 : 0, glow: lit(s, LISTS), dim: quiet(s, PYTEST, PARSE, LISTS, VERDICT) })),
    },
    {
      id: 'excluded', title: 'Excluded tests', detail: 'FAIL_TO_PASS tests that screening set aside before any result was seen. They still run, but they do not count towards the verdict.', source: 'src/uplift/screen.py:245',
      form: { kind: 'cells', key: 'excluded', rows: 1, cols: 1, color: INTERFACE.text2 }, size: [0.5, 0.2, 0.5], accent: INTERFACE.text2,
      poses: STATES.map((s) => ({ p: s >= VERDICT ? [-1.15, LOW + 0.02, 1.55] : s >= LISTS ? [-1.15, LOW + 0.02, 0.8] : [-2.5, MID + 0.02, 0.8], on: 1, reveal: s >= PARSE ? 1 : s === PYTEST ? 0.5 : 0, glow: lit(s, VERDICT), dim: quiet(s, PARSE, VERDICT) })),
    },
    {
      id: 'tape', ...step(PARSE), form: { kind: 'tape', key: 'tape', lines: 26 }, size: [1.8, 0.1, 3.4], accent: SPECTRAL.cyan, focus: { dist: 8, el: 0.7 },
      poses: pose([3.35, MID, 0], (s) => ({ reveal: s >= PYTEST ? 1 : 0, glow: lit(s, PARSE), dim: quiet(s, PYTEST, PARSE) })),
    },
    {
      id: 'tally', ...step(CHECK), form: { kind: 'tally', key: 'tally' }, size: [2.6, 0.2, 1.8], accent: SPECTRAL.cyan,
      poses: pose([-3.5, LOW, 0], (s) => ({ reveal: s >= CHECK ? 1 : 0, glow: lit(s, CHECK), dim: quiet(s, CHECK) })),
    },
    {
      id: 'verdict', title: 'Verdict', detail: `${GRADING_STEPS[8].detail} ${RESOLVED_RULE}`, source: source(8), form: { kind: 'seal', key: 'seal:resolved', outcome: 'resolved' }, size: [1.6, 0.2, 1.6], accent: OUTCOME.solved, focus: { dist: 7, el: 0.7 },
      poses: pose([3.6, LOW + 0.1, 0], (s) => ({ on: s === VERDICT ? 1 : 0, glow: 1 })),
    },
  ];
  const near = (x: number, y: number, dist = 9.6, yaw = -0.3): View => ({ target: [x, y, 0], dist, yaw, el: 0.62 });
  const views: View[] = [
    { target: [0, 0.1, 0], dist: 20, yaw: -0.36, el: 0.3 },
    near(-2.6, TOP + 0.2, 10.4), near(-0.2, TOP + 0.2, 10.4), near(0, TOP + 0.6, 10.4), near(2.6, TOP + 0.2, 10.4, -0.2),
    near(-0.8, MID, 12), near(1.4, MID, 12, -0.16), near(-2.6, LOW + 0.1, 10.4), near(0, LOW, 11.4, -0.1), near(1.6, LOW, 11.6, -0.16),
  ];
  const keyAt: Vec3[] = [[0, 1.6, 2.4], [-3.5, TOP + 1.4, 1.2], [0, TOP + 1.4, 1.2], [0, TOP + 1.6, 1.2], [3.3, TOP + 1.4, 1.2], [-1, MID + 1.4, 1.2], [2.6, MID + 1.4, 1.2], [-3.5, LOW + 1.4, 1.2], [0, LOW + 1.4, 1.2], [3, LOW + 1.4, 1.2]];
  const lights: Light[] = keyAt.map((p, s) => ({ p, warm: s ? 0.6 : 0.5, cool: 0.45 }));
  return {
    parts, views, lights,
    plan: (id, s) => {
      const f2p: [number, number, number, number] = s >= LISTS ? [170, 288, 64, 64] : [96, 168, 64, 64];
      const p2p: [number, number, number, number] = s >= LISTS ? [256, 280, 140, 80] : [176, 160, 140, 80];
      const flat: Record<string, [number, number, number, number]> = {
        'deck-prepare': [16, 8, 608, 120], 'deck-run': [16, 140, 608, 120], 'deck-decide': [16, 272, 608, 120],
        record: [36, 44, 130, 44], stack: [226, 40, 130, 60], hidden: s >= APPLY ? [262, 28, 58, 36] : [262, 12, 58, 26], bytecode: [420, 40, 180, 60],
        pytest: [70, 148, 280, 104], 'cells-f2p': f2p, 'cells-p2p': p2p, excluded: s >= VERDICT ? [176, 362, 14, 14] : null as never,
        tape: [450, 152, 150, 96], tally: [36, 296, 110, 70], verdict: [480, 296, 70, 70],
      };
      return flat[id] ?? null;
    },
    links: [
      { from: 'tape', to: 'cells-f2p', accent: SPECTRAL.cyan, on: STATES.map((s) => lit(s, PARSE)), fromAt: [-0.9, 0.05, -0.8], toAt: [0.4, 0.2, -0.4] },
      { from: 'tape', to: 'cells-p2p', accent: SPECTRAL.cyan, on: STATES.map((s) => lit(s, PARSE)), fromAt: [-0.9, 0.05, 0], toAt: [0.9, 0.2, 0] },
      { from: 'tape', to: 'cells-p2p', accent: SPECTRAL.cyan, on: STATES.map((s) => lit(s, PARSE)), fromAt: [-0.9, 0.05, 0.8], toAt: [0.9, 0.2, 0.7] },
    ],
    steps: [['record', 'stack', 'bytecode'], ['record'], ['stack'], ['hidden', 'stack'], ['bytecode'], ['pytest', 'cells-f2p', 'cells-p2p'], ['tape'], ['tally'], ['cells-f2p', 'cells-p2p'], ['verdict', 'excluded']],
  };
}
