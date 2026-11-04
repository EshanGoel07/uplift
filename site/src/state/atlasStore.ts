// The canonical research selection. One bug, condition and repeat are selected at a time, and every
// view (Nebula, Lattice, Bench, Atlas, Explorer, Inspector) reads them from here. The selection lives
// in the URL too, so a view can be shared, refreshed and walked through with Back and Forward.

import { useSyncExternalStore } from 'react';
import type { ArmId } from '../data/types';
import { FEATURED_TASK } from '../data/reportFigures';

export type InspectorTarget =
  | { kind: 'task' }
  | { kind: 'run' }
  | { kind: 'condition' }
  | { kind: 'compare' }
  | { kind: 'evidence'; id: string }
  | null;

/** One item on the comparison tray. */
export type CompareItem =
  | { kind: 'run'; task: string; arm: ArmId; repeat: number }
  | { kind: 'condition'; arm: ArmId };

export type ViewDensity = 'explore' | 'investigate';
export type HeroMode = 'bugs' | 'runs';

export interface AtlasState {
  /** The selected bug (full task id). */
  task: string;
  condition: ArmId | null;
  /** 0 or 1. */
  repeat: number | null;
  inspector: InspectorTarget;
  compare: CompareItem[];
  view: ViewDensity;
  heroMode: HeroMode;
  palette: boolean;
  tour: number | null;
}

const ARMS: ArmId[] = ['none', 'prose', 'sensors', 'both', 'handwritten', 'tuned'];
const isArm = (x: string | null): x is ArmId => !!x && (ARMS as string[]).includes(x);

const initial: AtlasState = {
  task: FEATURED_TASK, condition: null, repeat: null, inspector: null, compare: [],
  view: 'explore', heroMode: 'bugs', palette: false, tour: null,
};

// --- URL <-> state -----------------------------------------------------------------------------

/** Ids are shared without the repository prefix: ?task=fresh-63296846. */
export const taskParam = (id: string): string => id.replace(/^tobymao__sqlglot-/, '');
export const taskFromParam = (p: string): string => (p.startsWith('tobymao__sqlglot-') ? p : `tobymao__sqlglot-${p}`);

const compareToParam = (c: CompareItem): string => (c.kind === 'run' ? `${taskParam(c.task)}~${c.arm}~${c.repeat}` : c.arm);
function compareFromParam(p: string): CompareItem | null {
  const a = p.split('~');
  if (a.length === 3 && isArm(a[1]) && (a[2] === '0' || a[2] === '1')) return { kind: 'run', task: taskFromParam(a[0]), arm: a[1], repeat: +a[2] };
  if (a.length === 1 && isArm(a[0])) return { kind: 'condition', arm: a[0] };
  return null;
}

/** The URL parameters this store owns; anything else (?diag, ?nowebgl) is left alone. */
const OWNED = ['task', 'cond', 'rep', 'panel', 'cmp', 'view', 'hero'];

export function stateToParams(s: AtlasState, base = new URLSearchParams()): URLSearchParams {
  const q = new URLSearchParams(base);
  OWNED.forEach((k) => q.delete(k));
  if (s.task !== FEATURED_TASK) q.set('task', taskParam(s.task));
  if (s.condition) q.set('cond', s.condition);
  if (s.repeat !== null) q.set('rep', String(s.repeat + 1));
  if (s.inspector && s.inspector.kind !== 'evidence') q.set('panel', s.inspector.kind);
  if (s.compare.length) q.set('cmp', s.compare.map(compareToParam).join(','));
  if (s.view !== 'explore') q.set('view', s.view);
  if (s.heroMode !== 'bugs') q.set('hero', s.heroMode);
  return q;
}

export function paramsToState(q: URLSearchParams): Partial<AtlasState> {
  const p: Partial<AtlasState> = {};
  const t = q.get('task');
  p.task = t ? taskFromParam(t) : FEATURED_TASK;
  const c = q.get('cond');
  p.condition = isArm(c) ? c : null;
  const r = q.get('rep');
  p.repeat = r === '1' || r === '2' ? +r - 1 : null;
  const panel = q.get('panel');
  p.inspector = panel === 'task' || panel === 'run' || panel === 'condition' || panel === 'compare' ? { kind: panel } : null;
  p.compare = (q.get('cmp') ?? '').split(',').filter(Boolean).map(compareFromParam).filter((x): x is CompareItem => !!x).slice(0, 2);
  p.view = q.get('view') === 'investigate' ? 'investigate' : 'explore';
  p.heroMode = q.get('hero') === 'runs' ? 'runs' : 'bugs';
  return p;
}

// --- Store -------------------------------------------------------------------------------------

let state: AtlasState = {
  ...initial,
  ...(typeof window !== 'undefined' ? paramsToState(new URLSearchParams(window.location.search)) : {}),
};
const listeners = new Set<() => void>();

function writeUrl(mode: 'push' | 'replace'): void {
  if (typeof window === 'undefined') return;
  const q = stateToParams(state, new URLSearchParams(window.location.search)).toString();
  const url = `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`;
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  if (mode === 'push') window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}

export const atlas = {
  get: (): AtlasState => state,
  /** `history: 'push'` makes the change a Back step; use it for what a reader would call a new view. */
  set(patch: Partial<AtlasState>, history: 'push' | 'replace' | 'none' = 'replace'): void {
    let changed = false;
    for (const k of Object.keys(patch) as (keyof AtlasState)[]) {
      if (state[k] !== patch[k]) { changed = true; break; }
    }
    if (!changed) return;
    state = { ...state, ...patch };
    if (history !== 'none') writeUrl(history);
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useAtlas<T>(select: (s: AtlasState) => T): T {
  return useSyncExternalStore(atlas.subscribe, () => select(atlas.get()), () => select(atlas.get()));
}

// Actions with one meaning across the site.
export const selectTask = (task: string): void => atlas.set({ task, repeat: null }, 'push');
export const openTask = (task: string): void => atlas.set({ task, inspector: { kind: 'task' } }, 'push');
export const openRun = (task: string, arm: ArmId, repeat: number): void =>
  atlas.set({ task, condition: arm, repeat, inspector: { kind: 'run' } }, 'push');
export const openCondition = (arm: ArmId): void => atlas.set({ condition: arm, inspector: { kind: 'condition' } }, 'push');
export const closeInspector = (): void => atlas.set({ inspector: null }, 'push');

const sameItem = (a: CompareItem, b: CompareItem): boolean =>
  a.kind === 'run' && b.kind === 'run' ? a.task === b.task && a.arm === b.arm && a.repeat === b.repeat
    : a.kind === 'condition' && b.kind === 'condition' ? a.arm === b.arm : false;

/** Adds to the tray (at most two, newest kept), or removes the item if it is already there. */
export function toggleCompare(item: CompareItem): void {
  const cur = atlas.get().compare;
  const next = cur.some((c) => sameItem(c, item)) ? cur.filter((c) => !sameItem(c, item)) : [...cur.filter((c) => c.kind === item.kind), item].slice(-2);
  atlas.set({ compare: next });
}
export const inCompare = (s: AtlasState, item: CompareItem): boolean => s.compare.some((c) => sameItem(c, item));

export interface PairCheck { ok: boolean; reason: string }
/**
 * Whether two tray items form a meaningful comparison. Runs of different bugs are not matched pairs:
 * the study only compares conditions on the same bug.
 */
export function pairCheck(items: CompareItem[]): PairCheck {
  if (items.length < 2) return { ok: false, reason: 'Add a second item to compare.' };
  const [a, b] = items;
  if (a.kind !== b.kind) return { ok: false, reason: 'Compare two runs or two conditions, not one of each.' };
  if (a.kind === 'run' && b.kind === 'run' && a.task !== b.task) {
    return { ok: false, reason: 'These runs are from different bugs, so they are not a matched pair. The study only compares conditions on the same bug. You can still read each run on its own.' };
  }
  return { ok: true, reason: '' };
}

// Browser Back and Forward restore the selection.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    atlas.set(paramsToState(new URLSearchParams(window.location.search)), 'none');
  });
}
