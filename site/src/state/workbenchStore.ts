// Shared selection state for the workbench: the 3D scene (inside the R3F tree), the 2D diagram and
// the inspector all read and write the same store, so every view always shows the same thing.

import { useSyncExternalStore } from 'react';
import type { ArmId } from '../data/types';

export type Focus =
  | { kind: 'overview' }
  | { kind: 'source'; group: 'main' | 'dev' }
  | { kind: 'lane'; arm: ArmId }
  | { kind: 'run'; arm: ArmId; rep: number }
  | { kind: 'workspace' }
  | { kind: 'agent' }
  | { kind: 'evaluator' }
  | { kind: 'analysis' };

export interface WorkbenchState {
  /** Index into the workbench's ordered task list (test bugs, then fresh). */
  task: number;
  focus: Focus;
  view: '3d' | '2d';
  /** Per-run outcomes of the selected task, arm order then repeat order, once its file has loaded. */
  runs: boolean[][] | null;
}

let state: WorkbenchState = { task: 0, focus: { kind: 'overview' }, view: '3d', runs: null };
const listeners = new Set<() => void>();

export const wb = {
  get: (): WorkbenchState => state,
  set(patch: Partial<WorkbenchState>): void {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useWb<T>(select: (s: WorkbenchState) => T): T {
  return useSyncExternalStore(wb.subscribe, () => select(wb.get()), () => select(wb.get()));
}

/** The model's projected box relative to its stage, in CSS pixels; written on each refit, read by diagnostics. */
export const workbenchBounds = { left: 0, right: 0, top: 0, bottom: 0, stageWidth: 0, stageHeight: 0 };

/** DOM label elements, keyed as in scenes/Workbench/layout.ts; the 3D scene positions them each frame. */
export const wbLabels: Record<string, HTMLElement | null> = {};

/** The information-barrier side being looked at, derived from the focus ('none' = both shown fully). */
export type Side = 'none' | 'agent' | 'evaluator';
export const sideOf = (f: Focus): Side => (f.kind === 'agent' ? 'agent' : f.kind === 'evaluator' ? 'evaluator' : 'none');

export const focusIs = (f: Focus, kind: Focus['kind']): boolean => f.kind === kind;
