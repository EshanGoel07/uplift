// Shared state for the run lattice: HeroStage (DOM) writes it, the lattice scene inside the one
// canvas reads it. The DOM keeps every accessible control; the 3D scene only draws and reports.

import { useSyncExternalStore } from 'react';
import type { Arm, TaskMeta } from '../data/types';

export type LatticeMode = 'design' | 'outcomes';

export interface LatticeState {
  tasks: TaskMeta[];          // test bugs first, then fresh
  arms: Arm[];
  mode: LatticeMode;
  focus: number;              // bug index shown in the readout (stepped to)
  hovered: number | null;
  reduced: boolean;
  /** Fade everything except the selected bug's twelve runs. */
  isolateBug: boolean;
}

let state: LatticeState = { tasks: [], arms: [], mode: 'design', focus: 0, hovered: null, reduced: false, isolateBug: false };
const listeners = new Set<() => void>();

export const lattice = {
  get: (): LatticeState => state,
  set(patch: Partial<LatticeState>): void {
    let changed = false;
    for (const k of Object.keys(patch) as (keyof LatticeState)[]) {
      if (state[k] !== patch[k]) { changed = true; break; }
    }
    if (!changed) return;
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useLattice<T>(select: (s: LatticeState) => T): T {
  return useSyncExternalStore(lattice.subscribe, () => select(lattice.get()), () => select(lattice.get()));
}

/** Handlers the DOM installs for the scene's pointer events (hover, click) and its first complete frame. */
export const latticeHandlers: { onHover: (i: number | null) => void; onPick: (i: number) => void; onReady: () => void } = {
  onHover: () => {}, onPick: () => {}, onReady: () => {},
};

/** Projected DOM labels: one per lane, the two bug-group labels, then lane numbers for the back block. */
export const latticeLabels: (HTMLElement | null)[] = [];

/** 0..1 progress of the hero scrolling out, written by HeroStage and read by the camera. */
export const latticeScroll = { value: 0 };
