import type { ArmLike, TaskLike } from './types';

/**
 * Pure layout of the run lattice: where every run sits. No three.js, so it is testable and computed
 * once per arrangement rather than once per frame.
 *
 * Instances are ordered bug, then lane, then repeat, so one bug is a contiguous block of
 * lanes × repeats instances and its matrices can be updated without touching the rest.
 */
export const LANE = 0.52;       // lane pitch
export const BUG = 0.21;        // bug pitch
export const GROUP_GAP = 0.7;   // gap between test and fresh bugs
export const CUBE = 0.15;
export const REP = 0.095;       // repeat offset across a lane

export interface LatticeLayout {
  bugs: number;
  lanes: number;
  repeats: number;
  count: number;
  /** Instances in one bug's contiguous block. */
  perBug: number;
  nTest: number;
  wide: boolean;
  /** Length of the lattice along the bug axis (tall frames). */
  span: number;
  /** Width of one block (wide frames). */
  blockW: number;
  /** Distance between the two blocks (wide frames). */
  blockSep: number;
  /** World x, z of every instance: [x0, z0, x1, z1, ...]. */
  xz: Float32Array;
  /** Position of lane r across the lanes, centred. */
  laneAt: (r: number) => number;
  /** Position of bug i along the bug axis, centred (tall frames). */
  bugAt: (i: number) => number;
}

export const instanceIndex = (l: Pick<LatticeLayout, 'lanes' | 'repeats'>, bug: number, lane: number, repeat: number): number =>
  (bug * l.lanes + lane) * l.repeats + repeat;

export function latticeLayout(tasks: TaskLike[], arms: ArmLike[], wide: boolean): LatticeLayout {
  const bugs = tasks.length, lanes = arms.length;
  const repeats = Math.round(arms[0].attempts / bugs);
  const nTest = tasks.filter((t) => t.set === 'test').length;
  const count = bugs * lanes * repeats;
  const span = (bugs - 1) * BUG + GROUP_GAP;
  const blockW = (Math.max(nTest, bugs - nTest) - 1) * BUG;
  const blockSep = lanes * LANE + 0.9;
  const bugAt = (i: number) => i * BUG + (i >= nTest ? GROUP_GAP : 0) - span / 2;
  const laneAt = (r: number) => (r - (lanes - 1) / 2) * LANE;
  const blockX = (i: number) => (i >= nTest ? i - nTest : i) * BUG - blockW / 2;
  const blockZ = (i: number) => (i >= nTest ? -blockSep / 2 : blockSep / 2);

  const xz = new Float32Array(count * 2);
  const l = { bugs, lanes, repeats, count, perBug: lanes * repeats, nTest, wide, span, blockW, blockSep, xz, laneAt, bugAt };
  for (let i = 0; i < bugs; i++) {
    for (let r = 0; r < lanes; r++) {
      for (let q = 0; q < repeats; q++) {
        const across = laneAt(r) + (q - (repeats - 1) / 2) * REP * 2;
        const n = instanceIndex(l, i, r, q) * 2;
        xz[n] = wide ? blockX(i) : across;
        xz[n + 1] = wide ? blockZ(i) + across : -bugAt(i);
      }
    }
  }
  return l;
}

/**
 * Outcome of every instance in outcomes mode: of a bug's repeats in a lane, the first `solved` draw as
 * solved. The summary records how many repeats solved, which is what the lattice shows.
 */
export function outcomeAt(task: TaskLike, armId: string, repeat: number): boolean {
  return repeat < task.solved[armId];
}
