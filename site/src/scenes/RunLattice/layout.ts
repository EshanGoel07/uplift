import type { ArmLike, TaskLike } from './types';

/**
 * Pure layout of the run lattice: where every run sits. No three.js, so it is testable and computed
 * once per arrangement rather than once per frame.
 *
 * The runs form one curved sheet. A column is one bug, a row is one condition, and within a row a bug
 * holds a stacked pair of tiles, one per repeat. The test and fresh bugs share the sheet, split by a
 * gap. The curve and its slight wave are the same for every run, so position never carries meaning.
 *
 * Instances are ordered bug, then lane, then repeat, so one bug is a contiguous block of
 * lanes × repeats instances and its matrices can be updated without touching the rest.
 */
export const LANE = 0.98;       // row pitch
export const BUG = 0.135;       // column pitch along the curve
export const GROUP_GAP = 5;     // columns left empty between test and fresh bugs
export const REP = 0.185;       // repeat offset from the row's centre
export const TILE_W = BUG;      // tiles fill their pitch, so the pointer never falls between two
export const TILE_H = LANE * 0.6;  // taller than the visible tile: bridges the gap between rows for the pointer
export const TILE_VISIBLE = (REP * 2) / TILE_H;
export const ARC = 1.3;         // radians of curve across the sheet

export type Vec3 = [number, number, number];

export interface LatticeLayout {
  bugs: number;
  lanes: number;
  repeats: number;
  count: number;
  /** Instances in one bug's contiguous block. */
  perBug: number;
  nTest: number;
  wide: boolean;
  /** Column positions along the sheet, gap included. */
  columns: number;
  /** World position of every instance: [x0, y0, z0, x1, ...]. */
  pos: Float32Array;
  /** Outward surface direction of every instance: [x0, y0, z0, x1, ...]. */
  dir: Float32Array;
  /** Column of a bug on the sheet. */
  colAt: (bug: number) => number;
  /** Height of lane r across the sheet, centred; lane 0 is at the top. */
  laneAt: (r: number) => number;
  /** A point on the sheet: `col` along it (it may lie past the ends), `v` across it. */
  at: (col: number, v: number, out: Vec3) => Vec3;
}

export const instanceIndex = (l: Pick<LatticeLayout, 'lanes' | 'repeats'>, bug: number, lane: number, repeat: number): number =>
  (bug * l.lanes + lane) * l.repeats + repeat;

export function latticeLayout(tasks: TaskLike[], arms: ArmLike[], wide: boolean): LatticeLayout {
  const bugs = tasks.length, lanes = arms.length;
  const repeats = Math.round(arms[0].attempts / bugs);
  const nTest = tasks.filter((t) => t.set === 'test').length;
  const count = bugs * lanes * repeats;
  const columns = bugs + GROUP_GAP;
  const radius = (columns * BUG) / ARC;
  const colAt = (i: number) => i + (i >= nTest ? GROUP_GAP : 0);
  const laneAt = (r: number) => ((lanes - 1) / 2 - r) * LANE;
  const angle = (col: number) => (col / (columns - 1) - 0.5) * ARC;

  const at: LatticeLayout['at'] = (col, v, out) => {
    const a = angle(col);
    const along = Math.sin(a) * radius;
    const across = v + Math.sin(col * 0.075) * 0.13;
    if (wide) { out[0] = along; out[1] = across; } else { out[0] = -across; out[1] = -along; }
    out[2] = (Math.cos(a) - 1) * radius + Math.sin(col * 0.11 + v * 0.5) * 0.11;
    return out;
  };

  const pos = new Float32Array(count * 3), dir = new Float32Array(count * 3);
  const l: LatticeLayout = { bugs, lanes, repeats, count, perBug: lanes * repeats, nTest, wide, columns, pos, dir, colAt, laneAt, at };
  const p: Vec3 = [0, 0, 0];
  for (let i = 0; i < bugs; i++) {
    const col = colAt(i), a = angle(col);
    for (let r = 0; r < lanes; r++) {
      for (let q = 0; q < repeats; q++) {
        const n = instanceIndex(l, i, r, q) * 3;
        pos.set(at(col, laneAt(r) + ((repeats - 1) / 2 - q) * REP * 2, p), n);
        dir[n] = wide ? Math.sin(a) : 0;
        dir[n + 1] = wide ? 0 : -Math.sin(a);
        dir[n + 2] = Math.cos(a);
      }
    }
  }
  return l;
}

/**
 * Outcome of every instance in outcomes mode: of a bug's repeats in a lane, the first `solved` draw as
 * solved. The summary records how many repeats solved, which is what the lattice shows, so the order
 * within a pair is not meaningful.
 */
export function outcomeAt(task: TaskLike, armId: string, repeat: number): boolean {
  return repeat < task.solved[armId];
}
