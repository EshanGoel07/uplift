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
