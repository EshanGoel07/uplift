// Shared state between the DOM sections and the one WebGL canvas.
//
// Two parts:
//  - `ui`: values the interface shows (reduced motion, WebGL availability, the most visible scene),
//    a tiny subscribe/emit store used with useSyncExternalStore.
//  - `scenes`: the scene registry. A section *requests* a scene for a DOM stage element; the canvas
//    *mounts* it; the registry *measures* how much of each stage is on screen and wakes the renderer
//    only when a visible scene needs a new frame. Mounted never means "render continuously": the
//    canvas runs on demand, and a scene that animates asks for frames while it animates.

import { useSyncExternalStore } from 'react';

/** Stable scene identifiers. Future scenes (e.g. 'nebula') join this union. */
export type SceneId = 'nebula' | 'lattice' | 'workbench' | 'cohort';
/** @deprecated alias kept for existing imports. */
export type SceneName = SceneId;

export interface Live {
  /** 0..1 how much of the workbench's 3D stage is on screen (0 when the 2D diagram is shown). Written by the registry. */
  workbenchVis: number;
}
export const live: Live = { workbenchVis: 0 };

export interface UiState {
  /** Reduced motion starts paused: scenes draw a composed still frame and skip time-based motion. */
  paused: boolean;
  reducedMotion: boolean;
  webgl: boolean;
  /** The most visible 3D scene, if any (derived from the registry). */
  activeScene: SceneId | null;
  /** Mobile/low tier: no bloom, lower pixel ratio. */
  lowTier: boolean;
  /** The Workbench's lazy 3D layer failed; its section stays on the 2D diagram. Other scenes are unaffected. */
  workbench3dFailed: boolean;
}

const prefersReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function detectWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('nowebgl')) return false;
  // Cheap feature check; creating a throwaway context costs ~100 ms. If the real context fails,
  // the canvas error boundary flips this to false and the SVG/HTML fallbacks take over.
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
  reducedMotion: !!prefersReduced,
  webgl: detectWebGL(),
  activeScene: null,
  lowTier: detectLowTier(),
  workbench3dFailed: false,
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

// --- Rendering wake-up -------------------------------------------------------------------------

/** Invalidation reasons, counted for diagnostics (`window.__upliftDiag`). */
export type FrameReason = 'scroll' | 'resize' | 'visibility' | 'pointer' | 'animation' | 'state' | 'mount' | 'other';
export const invalidations: Record<FrameReason, number> = { scroll: 0, resize: 0, visibility: 0, pointer: 0, animation: 0, state: 0, mount: 0, other: 0 };

let invalidator: (() => void) | null = null;
export const setInvalidator = (fn: (() => void) | null): void => { invalidator = fn; };
/** Requests one more frame (the canvas renders on demand). */
export const requestFrame = (reason: FrameReason = 'other'): void => {
  if (!invalidator) return;
  invalidations[reason]++;
  invalidator();
};

// --- Scene registry ----------------------------------------------------------------------------

export interface SceneCaps {
  /** 'static': draws a still composition under reduced motion; 'full': has no motion to remove. */
  reducedMotion: 'static' | 'full';
  /** Whether the scene runs on low-tier devices (phones, <= 4 cores). */
  lowTier: boolean;
}

export interface SceneEntry {
  id: SceneId;
  /** A section wants this scene (it has a DOM stage for it). */
  requested: boolean;
  /** The canvas has mounted the scene's objects. */
  mounted: boolean;
  /** 0..1 fraction of the stage on screen. */
  visibility: number;
  visible: boolean;
  /** Set while the scene is asking for frames (an entrance, a transition); cleared when it settles. */
  animating: boolean;
  stage: HTMLElement | null;
  caps: SceneCaps;
  /** Lifecycle counters, for diagnostics and tests. */
  mounts: number;
  disposals: number;
}

export type ScenePhase = 'available' | 'requested' | 'mounted' | 'visible' | 'active' | 'animating' | 'paused' | 'disposed';

const VISIBLE_AT = 0.01;
const DEFAULT_CAPS: SceneCaps = { reducedMotion: 'static', lowTier: true };
const entries = new Map<SceneId, SceneEntry>();
const sceneListeners = new Set<() => void>();
let version = 0;
const emit = (): void => { version++; sceneListeners.forEach((l) => l()); };

function entry(id: SceneId): SceneEntry {
  let e = entries.get(id);
  if (!e) {
    e = { id, requested: false, mounted: false, visibility: 0, visible: false, animating: false, stage: null, caps: DEFAULT_CAPS, mounts: 0, disposals: 0 };
    entries.set(id, e);
  }
  return e;
}

/** Fraction (0..1) of an element's box inside the viewport, measured against the smaller of the two heights. */
export function visibleFraction(el: Element | null): number {
  if (!el || typeof window === 'undefined') return 0;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return 0;
  const vh = window.innerHeight, vw = window.innerWidth;
  const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
  const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
  if (w === 0) return 0;
  return Math.min(1, h / Math.max(1, Math.min(r.height, vh)));
}

// One measurement loop for every requested stage: attached while anything is requested.
let attached = false;
let pending = 0;
let pendingReason: FrameReason = 'scroll';

function measure(reason: FrameReason): void {
  let changed = false, anyVisible = false, flipped = false;
  for (const e of entries.values()) {
    if (!e.requested) continue;
    const v = visibleFraction(e.stage);
    const vis = v >= VISIBLE_AT;
    if (vis !== e.visible) { flipped = true; changed = true; }
    if (Math.abs(v - e.visibility) > 1e-3) changed = true;
    e.visibility = v; e.visible = vis;
    if (vis) anyVisible = true;
  }
  live.workbenchVis = entries.get('workbench')?.visibility ?? 0;
  const most = [...entries.values()].filter((e) => e.requested && e.visible).sort((a, b) => b.visibility - a.visibility)[0];
  ui.set({ activeScene: most ? most.id : null });
  // Only a visible scene (whose stage moved) or a visibility flip (one clearing frame) needs a render.
  // Scroll wakes visible scenes in onScroll itself, so the frame lands in the same paint as the page.
  if (flipped) requestFrame('visibility');
  else if (anyVisible && reason !== 'scroll') requestFrame(reason);
  if (changed) emit();
}

const onScroll = (): void => {
  for (const e of entries.values()) if (e.requested && e.visible) { requestFrame('scroll'); break; }
  schedule('scroll');
};
const onResize = (): void => schedule('resize');
function schedule(reason: FrameReason): void {
  pendingReason = reason;
  if (pending) return;
  pending = window.requestAnimationFrame(() => { pending = 0; measure(pendingReason); });
}

function attach(): void {
  if (attached || typeof window === 'undefined') return;
  attached = true;
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
}
function detach(): void {
  if (!attached) return;
  attached = false;
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', onResize);
  if (pending) { window.cancelAnimationFrame(pending); pending = 0; }
}

export const scenes = {
  /** A section asks for a scene drawn into `stage`. Returns the release function (call it on unmount). */
  request(id: SceneId, stage: HTMLElement | null, caps: Partial<SceneCaps> = {}): () => void {
    const e = entry(id);
    e.requested = true; e.stage = stage; e.caps = { ...DEFAULT_CAPS, ...caps };
    attach();
    measure('visibility');
    emit();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      e.requested = false; e.stage = null; e.visibility = 0; e.visible = false; e.animating = false;
      if (id === 'workbench') live.workbenchVis = 0;
      if (![...entries.values()].some((x) => x.requested)) detach();
      measure('visibility');
      emit();
    };
  },
  setMounted(id: SceneId, mounted: boolean): void {
    const e = entry(id);
    if (e.mounted === mounted) return;
    e.mounted = mounted;
    if (mounted) e.mounts++; else { e.disposals++; e.animating = false; }
    emit();
  },
  /** Called from a scene's frame callback: it changed something over time and needs another frame. */
  animate(id: SceneId): void {
    const e = entry(id);
    if (!e.animating) { e.animating = true; emit(); }
    requestFrame('animation');
  },
  /** Called when the scene has settled (no more frames needed). */
  settle(id: SceneId): void {
    const e = entries.get(id);
    if (e?.animating) { e.animating = false; emit(); }
  },
  get: (id: SceneId): SceneEntry => entry(id),
  list: (): SceneEntry[] => [...entries.values()],
  isVisible: (id: SceneId): boolean => !!entries.get(id)?.visible,
  phase(id: SceneId): ScenePhase {
    const e = entries.get(id);
    if (!e) return 'available';
    if (!e.requested) return e.disposals > 0 && !e.mounted ? 'disposed' : 'available';
    if (!e.mounted) return 'requested';
    if (!e.visible) return 'mounted';
    if (ui.get().paused && e.caps.reducedMotion === 'static') return 'paused';
    return e.animating ? 'animating' : 'active';
  },
  /** Re-measure now (after a layout change the registry cannot observe, e.g. a view toggle). */
  remeasure(): void { if (attached) measure('state'); },
  subscribe(l: () => void): () => void { sceneListeners.add(l); return () => sceneListeners.delete(l); },
  /** Test helper: whether the shared scroll/resize listeners are attached, and whether a frame is pending. */
  _listening: (): { attached: boolean; pending: boolean } => ({ attached, pending: pending !== 0 }),
};

/** Re-renders when the registry changes; returns `select(registry)`. */
export function useScenes<T>(select: () => T): T {
  return useSyncExternalStore(scenes.subscribe, select, select);
}
export const sceneVersion = (): number => version;

// Read-only handle for browser tests and debugging (no secrets, no model calls).
if (typeof window !== 'undefined') {
  (window as unknown as { __uplift: unknown }).__uplift = {
    live, ui: { get: () => ui.get() },
    scenes: { list: () => scenes.list().map((e) => ({ id: e.id, phase: scenes.phase(e.id), visibility: +e.visibility.toFixed(3), mounts: e.mounts, disposals: e.disposals })) },
  };
}
