// Shared state for the 3D story models: the section (DOM) writes it, the scene in the one canvas reads it.
// A model is data: parts with a pose per story state, the camera views, and what connects them. The DOM
// keeps every control and all the words; the scene only draws and reports what the pointer picked.

import { useSyncExternalStore } from 'react';
import { requestFrame } from './sceneStore';

export type AssemblyId = 'workspace' | 'cutaway' | 'grading';
export type Vec3 = [number, number, number];

export interface PartPose {
  /** World position of the part's centre. */
  p: Vec3;
  /** 0 absent, 1 present. */
  on: number;
  /** 0 at rest, 1 fully emphasised. */
  glow?: number;
  /** How far this part's own sequence has run, 0 to 1. See `aGate` in graphiteMaterial. */
  reveal?: number;
  scale?: number;
  /** Euler rotation. */
  rot?: Vec3;
  /** Below 1, the part recedes because this step is about something else. */
  dim?: number;
}

/** One line of a document, as a stroke: its real length as a share of the sheet, and what kind of line it is. */
export interface Stroke { len: number; tone?: 'plain' | 'add' | 'del' | 'hunk' | 'code' | 'head' }

export const LINE_PITCH = 0.082;
export const DIFF_PITCH = 0.07;
export const sheetDepth = (lines: number): number => 0.62 + lines * LINE_PITCH;

/** What a part is made of. `key` changes exactly when the geometry must be rebuilt. */
export type Form =
  | { kind: 'repo'; key: string; width: number; depth: number; lit: { path: string; color: string; seq: number }[] }
  | { kind: 'sheet'; key: string; shape: 'ticket' | 'doc'; width: number; lines: Stroke[]; color: string }
  | { kind: 'ghost'; key: string; width: number; depth: number; color: string }
  | { kind: 'commit'; key: string; color: string }
  | { kind: 'hooks'; key: string; checks: string[]; color: string }
  | { kind: 'core'; key: string }
  | { kind: 'diff'; key: string; width: number; lines: Stroke[] }
  | { kind: 'spine'; key: string; height: number };

export interface Part {
  id: string;
  title: string;
  detail: string;
  /** Repository path this part comes from, where there is one. */
  source?: string;
  /** Bespoke geometry, built by scenes/Assembly/forms.ts. Without one the part is a plain solid of `shape`. */
  form?: Form;
  shape?: 'slab' | 'column' | 'wall';
  /** Smoked glass: a boundary to see through, not a solid. */
  glass?: boolean;
  /** Width, height, depth. */
  size: Vec3;
  accent: string;
  /** One pose per story state. */
  poses: PartPose[];
  /** Structure the reader cannot select, such as a spine or a floor. */
  inert?: boolean;
  /** Radius of a soft light around the part, for the light sources. */
  halo?: number;
  /** How strongly its inks show at rest, before glow. */
  inkRest?: number;
  /** Where the camera goes when this part is selected, where the default framing is not right. */
  focus?: Partial<View>;
}

export interface Link { from: string; to: string; accent: string; on: number[]; fromAt?: Vec3; toAt?: Vec3 }
export interface View { target: Vec3; dist: number; yaw: number; el: number }
/** The light of one story state: the warm source at the model's centre and the cool spectral rim. */
export interface Light { p: Vec3; warm: number; cool: number }
export interface Model {
  parts: Part[];
  links: Link[];
  views: View[];
  /** One per state. Defaults to a warm centre. */
  lights?: Light[];
  /** The objects each state is about, which are the only ones listed on the stage. */
  steps?: string[][];
}

export interface Assembly {
  model: Model | null;
  state: number;
  selected: string | null;
  hovered: string | null;
  /** The reader's own turn of the model, on top of the story's view. */
  yaw: number;
  pitch: number;
  reduced: boolean;
  settledAt: number;
}

const blank = (): Assembly => ({ model: null, state: 0, selected: null, hovered: null, yaw: 0, pitch: 0, reduced: false, settledAt: -1 });
export const assemblies: Record<AssemblyId, Assembly> = { workspace: blank(), cutaway: blank(), grading: blank() };

const listeners = new Set<() => void>();
const emit = (): void => { listeners.forEach((l) => l()); requestFrame('state'); };

export function setAssembly(id: AssemblyId, patch: Partial<Assembly>): void {
  const a = assemblies[id];
  let changed = false;
  for (const k of Object.keys(patch) as (keyof Assembly)[]) if (a[k] !== patch[k]) changed = true;
  if (!changed) return;
  if ('state' in patch && patch.state !== a.state) a.settledAt = -1;
  if ('model' in patch && patch.model !== a.model) a.settledAt = -1;
  Object.assign(a, patch);
  emit();
}

export function useAssembly<T>(select: () => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, select, select);
}
