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
}

export interface Part {
  id: string;
  title: string;
  detail: string;
  /** Repository path this part comes from, where there is one. */
  source?: string;
  shape?: 'slab' | 'column' | 'wall';
  /** Width, height, depth. */
  size: Vec3;
  accent: string;
  /** One pose per story state. */
  poses: PartPose[];
}

export interface Link { from: string; to: string; accent: string; on: number[] }
export interface View { target: Vec3; dist: number; yaw: number; el: number }
export interface Model { parts: Part[]; links: Link[]; views: View[] }

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
  label: HTMLElement | null;
}

const blank = (): Assembly => ({ model: null, state: 0, selected: null, hovered: null, yaw: 0, pitch: 0, reduced: false, settledAt: -1, label: null });
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
