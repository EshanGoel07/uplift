// View state of the Nebula Atlas: which lens is on, and where the controls want the view to be.
// The selected bug itself lives in atlasStore, like everywhere else on the site.

import { useSyncExternalStore } from 'react';

export type NebulaLens = 'explore' | 'outcome' | 'condition';
export const DEFAULT_VIEW = { yaw: -0.62, pitch: 0.32, zoom: 1 };

export interface NebulaState {
  lens: NebulaLens;
  hovered: number | null;
  /** Bump to bring the selected bug to the front. */
  focusTick: number;
  /** Target view; the scene eases toward it. */
  yaw: number;
  pitch: number;
  zoom: number;
}

let state: NebulaState = { lens: 'explore', hovered: null, focusTick: 0, ...DEFAULT_VIEW };
const listeners = new Set<() => void>();

export const nebula = {
  get: (): NebulaState => state,
  set(patch: Partial<NebulaState>): void {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useNebula<T>(select: (s: NebulaState) => T): T {
  return useSyncExternalStore(nebula.subscribe, () => select(nebula.get()), () => select(nebula.get()));
}

/** DOM elements the scene positions: the bug tag on the node, and the thread from the node to the inspector. */
export const nebulaDom: { tag: HTMLElement | null; thread: SVGLineElement | null } = { tag: null, thread: null };
