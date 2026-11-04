import type { ArmId, Summary } from '../../data/types';
import { shortId } from '../../data/classify';
import { FEATURED_TASK } from '../../data/reportFigures';
import type { HeroMode, ViewDensity } from '../../state/atlasStore';

export type PaletteAction =
  | { type: 'section'; id: string }
  | { type: 'task'; id: string }
  | { type: 'condition'; id: ArmId }
  | { type: 'run'; task: string; arm: ArmId; repeat: number }
  | { type: 'module'; name: string }
  | { type: 'hero'; mode: HeroMode }
  | { type: 'view'; view: ViewDensity }
  | { type: 'tour' };

export interface PaletteItem { key: string; type: string; label: string; sub?: string; text: string; action: PaletteAction; rank: number }

/** The sections and actions that exist on the page. Everything else comes from the study's records. */
const SECTIONS: [string, string][] = [
  ['overview', 'Overview'], ['how', 'How it works'], ['story', 'From one bug to 924'], ['conditions', 'Conditions'], ['workspace', 'Inside one run'], ['cutaway', 'Agent and evaluator'], ['grading', 'The grader'], ['method', 'Experiment Bench'], ['findings', 'Findings'],
  ['explore', 'Explore bugs'], ['explorer', 'WINDOW Investigation'], ['matrix', 'Bug Atlas'],
  ['details', 'Research details'], ['architecture', 'Architecture'], ['trust', 'Research Integrity'], ['limitations', 'Limitations'],
];

export function buildIndex(s: Summary, modules: string[] = []): PaletteItem[] {
  const items: PaletteItem[] = [];
  const add = (it: Omit<PaletteItem, 'text'>) => items.push({ ...it, text: `${it.type} ${it.label} ${it.sub ?? ''}`.toLowerCase() });
  for (const [id, label] of SECTIONS) add({ key: `s-${id}`, type: 'Go to', label, action: { type: 'section', id }, rank: 0 });
  add({ key: 'a-tour', type: 'Action', label: 'Start the guided tour', action: { type: 'tour' }, rank: 1 });
  add({ key: 'a-bugs', type: 'Action', label: 'Show the 77 bugs (Nebula)', action: { type: 'hero', mode: 'bugs' }, rank: 1 });
  add({ key: 'a-runs', type: 'Action', label: 'Show the 924 runs (Lattice)', action: { type: 'hero', mode: 'runs' }, rank: 1 });
  add({ key: 'a-exp', type: 'Action', label: 'Switch to Explore view', action: { type: 'view', view: 'explore' }, rank: 1 });
  add({ key: 'a-inv', type: 'Action', label: 'Switch to Investigate view', action: { type: 'view', view: 'investigate' }, rank: 1 });
  add({ key: 'a-win', type: 'Action', label: 'Open the WINDOW bug', sub: shortId(FEATURED_TASK), action: { type: 'task', id: FEATURED_TASK }, rank: 1 });
  for (const a of s.arms) add({ key: `c-${a.id}`, type: 'Condition', label: a.label, sub: `${a.solved}/${a.attempts} solved`, action: { type: 'condition', id: a.id }, rank: 2 });
  for (const t of s.tasks) add({ key: `t-${t.id}`, type: 'Bug', label: t.title, sub: shortId(t.id), action: { type: 'task', id: t.id }, rank: 3 });
  for (const m of modules) add({ key: `m-${m}`, type: 'Source', label: m, sub: 'Python module', action: { type: 'module', name: m }, rank: 3 });
  return items;
}

/**
 * Every word of the query must appear. Run records (924 of them) are only added once a query names a
 * bug, by matching a condition and repeat: "4347 tuned 2".
 */
export function searchIndex(items: PaletteItem[], query: string): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items.filter((i) => i.rank <= 2);
  const hit = items.filter((i) => words.every((w) => i.text.includes(w))).sort((a, b) => a.rank - b.rank);
  const repeat = words.find((w) => w === '1' || w === '2' || w === 'r1' || w === 'r2');
  const armWords = words.filter((w) => w !== repeat);
  const bug = items.find((i) => i.action.type === 'task' && armWords.some((w) => i.sub?.toLowerCase().includes(w)));
  const arm = items.find((i) => i.action.type === 'condition' && armWords.some((w) => i.label.toLowerCase().includes(w)));
  if (bug && arm && bug.action.type === 'task' && arm.action.type === 'condition') {
    const reps = repeat ? [+repeat.replace('r', '') - 1] : [0, 1];
    const runs = reps.map((r): PaletteItem => ({
      key: `r-${bug.sub}-${arm.label}-${r}`, type: 'Run', label: `${arm.label}, repeat ${r + 1}`, sub: bug.sub, text: '', rank: 2,
      action: { type: 'run', task: (bug.action as { id: string }).id, arm: (arm.action as { id: ArmId }).id, repeat: r },
    }));
    return [...runs, ...hit];
  }
  return hit;
}
