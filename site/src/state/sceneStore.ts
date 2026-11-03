// Shared state between the DOM (ScrollTrigger, buttons) and the WebGL scenes.
//
// Fast-changing values (scroll progress, rotation, pointer) are plain mutable fields read inside
// useFrame, so scrolling never triggers React renders. Values the interface shows (paused,
// interact mode, active pipeline stage, hotspot) go through a tiny subscribe/emit store used with
// useSyncExternalStore.

import { useSyncExternalStore } from 'react';

export type SceneName = 'hero' | 'matrix' | 'pipeline';

export interface Live {
  /** 0..1 progress through the pinned hero sequence. */
  hero: number;
  /** 0..1 how far the hero has scrolled out (fades the scene). */
  heroOut: number;
  /** 0..1 progress through the matrix unfolding sequence. */
  matrix: number;
  /** 0..1 visibility of the matrix stage. */
  matrixVis: number;
  /** 0..1 progress through the methodology sequence. */
  pipeline: number;
  /** 0..1 visibility of the pipeline stage (approach). */
  pipelineVis: number;
  /** 0..1 how far the pipeline stage has scrolled away. */
  pipelineOut: number;
  /** Pointer in normalised device coords (-1..1), and whether it is over the page. */
  pointer: { x: number; y: number; active: boolean };
  /** User rotation (radians) and zoom per scene; Reset tweens these back to 0 / 1. */
  rot: Record<SceneName, { x: number; y: number }>;
  zoom: Record<SceneName, number>;
  /** Simulation time; only advances while not paused. */
  time: number;
}

export const live: Live = {
  hero: 0,
  heroOut: 0,
  matrix: 0,
  matrixVis: 0,
  pipeline: 0,
  pipelineVis: 0,
  pipelineOut: 0,
  pointer: { x: 0, y: 0, active: false },
  rot: { hero: { x: 0, y: 0 }, matrix: { x: 0, y: 0 }, pipeline: { x: 0, y: 0 } },
  zoom: { hero: 1, matrix: 1, pipeline: 1 },
  time: 0,
};

export interface UiState {
  paused: boolean;
  interact: boolean;
  reducedMotion: boolean;
  webgl: boolean;
  /** Which 3D scene is currently on screen, if any (drives the controls bar). */
  activeScene: SceneName | null;
  /** Pipeline stage 0..4 driven by scroll; `pipelinePick` overrides it after a click. */
  pipelineStage: number;
  pipelinePick: number | null;
  /** Hero hotspot opened by a click (index), or null. */
  hotspot: number | null;
  /** Bumped by Reset so scenes can restart their tweens. */
  resetTick: number;
  /** Mobile/low tier: fewer particles and segments. */
  lowTier: boolean;
}

const prefersReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function detectWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('nowebgl')) return false;
  // Cheap feature check; creating a throwaway context costs ~100 ms. If the real context fails,
  // the canvas error boundary flips this to false and the static poster takes over.
  return typeof window !== 'undefined' && ('WebGL2RenderingContext' in window || 'WebGLRenderingContext' in window);
}

function detectLowTier(): boolean {
  if (typeof window === 'undefined') return false;
  const small = window.matchMedia?.('(max-width: 760px)').matches;
  const cores = (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency ?? 8;
  return !!small || cores <= 4;
}

let state: UiState = {
  paused: !!prefersReduced,
  interact: false,
  reducedMotion: !!prefersReduced,
  webgl: detectWebGL(),
  activeScene: null,
  pipelineStage: 0,
  pipelinePick: null,
  hotspot: null,
  resetTick: 0,
  lowTier: detectLowTier(),
};

const listeners = new Set<() => void>();

export const ui = {
  get: (): UiState => state,
  set(patch: Partial<UiState>): void {
    let changed = false;
    for (const k of Object.keys(patch) as (keyof UiState)[]) {
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

export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(ui.subscribe, () => select(ui.get()), () => select(ui.get()));
}

/** Requests one more frame when the canvas runs on demand (paused or reduced motion). */
let invalidator: (() => void) | null = null;
export const setInvalidator = (fn: (() => void) | null): void => { invalidator = fn; };
export const requestFrame = (): void => { invalidator?.(); };

export function resetView(): void {
  for (const k of Object.keys(live.rot) as SceneName[]) {
    live.rot[k].x = 0;
    live.rot[k].y = 0;
    live.zoom[k] = 1;
  }
  ui.set({ resetTick: ui.get().resetTick + 1, hotspot: null, pipelinePick: null });
  requestFrame();
}

// Read-only handle for browser tests and debugging (no secrets, no model calls).
if (typeof window !== 'undefined') {
  (window as unknown as { __uplift: unknown }).__uplift = { live, ui: { get: () => ui.get() } };
}
