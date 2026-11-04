// Model-space layout of the workbench, shared by the 3D scene (geometry, label anchors) and the DOM
// (which renders the labels as real buttons, so every module is reachable by keyboard).
// Units are arbitrary; x runs left to right through the pipeline, z across the six lanes, y up.

import type { Focus } from '../../state/workbenchStore';

export const LANES = 6;
export const laneZ = (r: number): number => (r - (LANES - 1) / 2) * 1.0;
export const repZ = (r: number, k: number): number => laneZ(r) + (k - 0.5) * 0.44;

export const X = {
  tray: -8.55,      // A: task source
  dev: -8.55,
  manifold: -6.55,
  laneStart: -6.3,
  setup: -5.35,     // B: each lane's setup module
  laneEnd: -1.15,
  ws: 0.45,         // C: workspaces
  wall: 2.45,       // D: information barrier
  bench: 4.25,      // E: evaluator
  analysis: 7.55,   // F: paired analysis
} as const;

export const Z = { devTray: 4.55, tests: 3.75 } as const;

/** Bounding box used to fit the model into the stage. */
export const BOUNDS = { x0: -10.6, x1: 9.4, z0: -4.1, z1: 5.7, y0: 0, y1: 1.4 };

/** The perspective camera's view of the z = 0 plane, as plain numbers (no three.js, so it is testable). */
export interface FitCamera { tanHalfFov: number; aspect: number; z: number }
/** A stage rectangle in client pixels, and the viewport it sits in. */
export interface FitStage { left: number; top: number; width: number; height: number; vw: number; vh: number }
export interface Fit { scale: number; x: number; y: number; left: number; right: number; top: number; bottom: number }

/** Depth behind the z = 0 plane: the model is drawn here and scaled up, so perspective stays gentle. */
export const BACK = 30;
/** The model may fill this share of the stage's width and height. */
export const FIT_W = 0.9, FIT_H = 0.88;

/**
 * Scale and offset that place the model inside its stage *as the perspective camera actually draws it*.
 * `pts` are the rotated model corners [x, y, z, x, y, z, ...]. The near edge projects larger than the
 * far edge, so a fit from the rotated extents alone overruns the stage; this measures the projected box
 * and corrects until it fits. It converges in a few passes and allocates nothing but its result.
 */
export function fitToStage(pts: ArrayLike<number>, cam: FitCamera, st: FitStage): Fit {
  const halfH = cam.tanHalfFov * cam.z, halfW = halfH * cam.aspect;
  const toX = (px: number) => ((px / st.vw) * 2 - 1) * halfW;
  const toY = (py: number) => (1 - (py / st.vh) * 2) * halfH;
  const cx = st.left + st.width / 2, cy = st.top + st.height / 2;
  const m = (cam.z + BACK) / cam.z;   // world units at the model's depth per world unit at z = 0
  let scale = (toX(st.left + st.width) - toX(st.left)) * m / 20, x = toX(cx) * m, y = toY(cy) * m;
  let left = 0, right = 0, top = 0, bottom = 0;
  const measure = () => {
    left = Infinity; right = -Infinity; top = Infinity; bottom = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const depth = cam.z + BACK - pts[i + 2] * scale;
      const px = (((pts[i] * scale + x) / (cam.tanHalfFov * cam.aspect * depth)) * 0.5 + 0.5) * st.vw;
      const py = (0.5 - ((pts[i + 1] * scale + y) / (cam.tanHalfFov * depth)) * 0.5) * st.vh;
      if (px < left) left = px;
      if (px > right) right = px;
      if (py < top) top = py;
      if (py > bottom) bottom = py;
    }
  };
  for (let pass = 0; pass < 6; pass++) {
    measure();
    scale *= Math.min((st.width * FIT_W) / (right - left), (st.height * FIT_H) / (bottom - top));
    measure();
    // Move the box's centre onto the stage's centre.
    x += toX(cx) * m - toX((left + right) / 2) * m;
    y += toY(cy) * m - toY((top + bottom) / 2) * m;
  }
  measure();
  return { scale, x, y, left, right, top, bottom };
}

export interface LabelDef {
  key: string;
  at: [number, number, number];
  /** Where the label sits relative to its anchor. */
  align: 'center' | 'left' | 'right';
  focus?: Focus;
  kind: 'module' | 'lane' | 'note' | 'side';
}

export const MODULE_LABELS: LabelDef[] = [
  { key: 'A', at: [X.tray, 0, -3.15], align: 'center', kind: 'module', focus: { kind: 'source', group: 'main' } },
  { key: 'B', at: [-3.3, 0, -4.0], align: 'center', kind: 'module', focus: { kind: 'lane', arm: 'none' } },
  { key: 'C', at: [X.ws, 0, 3.4], align: 'center', kind: 'module', focus: { kind: 'workspace' } },
  { key: 'D', at: [X.wall, 1.5, -3.35], align: 'center', kind: 'module', focus: { kind: 'agent' } },
  { key: 'E', at: [X.bench, 0, -3.4], align: 'center', kind: 'module', focus: { kind: 'evaluator' } },
  { key: 'F', at: [X.analysis, 0, -3.4], align: 'center', kind: 'module', focus: { kind: 'analysis' } },
  { key: 'dev', at: [X.dev, 0, 5.45], align: 'center', kind: 'note', focus: { kind: 'source', group: 'dev' } },
  { key: 'tests', at: [X.bench + 0.7, 0.35, Z.tests], align: 'left', kind: 'note', focus: { kind: 'evaluator' } },
  { key: 'agentSide', at: [X.wall - 0.3, 0, 5.0], align: 'right', kind: 'side', focus: { kind: 'agent' } },
  { key: 'evalSide', at: [X.wall + 0.3, 0, 5.0], align: 'left', kind: 'side', focus: { kind: 'evaluator' } },
];

/** Lane labels sit on each lane, just after its setup module. */
export const laneLabelAt = (r: number): [number, number, number] => [X.setup + 0.55, 0.1, laneZ(r)];
