import type { ArmId, Group, Summary, Task, TaskMeta } from './types';

export const BASELINE: ArmId = 'none';

/** 12 outcomes per task (6 arms x 2 repeats): all resolved, none resolved, or mixed. */
export function groupOf(solvedByArm: Record<string, number>, runsPerArm = 2): Group {
  const vals = Object.values(solvedByArm);
  const total = vals.reduce((a, b) => a + b, 0);
  if (total === vals.length * runsPerArm) return 'always';
  if (total === 0) return 'never';
  return 'mixed';
}

export function groupCounts(tasks: Pick<TaskMeta, 'solved'>[]): Record<Group, number> {
  const c: Record<Group, number> = { always: 0, mixed: 0, never: 0 };
  for (const t of tasks) c[groupOf(t.solved)]++;
  return c;
}

/** Tasks where an arm solved more (won) or fewer (lost) of the repeats than No setup. */
export function winsLosses(tasks: Pick<TaskMeta, 'solved'>[], arm: ArmId): { won: number; lost: number } {
  let won = 0, lost = 0;
  for (const t of tasks) {
    const d = t.solved[arm] - t.solved[BASELINE];
    if (d > 0) won++;
    else if (d < 0) lost++;
  }
  return { won, lost };
}

export const GROUP_ORDER: Group[] = ['always', 'mixed', 'never'];
export const GROUP_LABEL: Record<Group, string> = {
  always: 'Always solved',
  mixed: 'Mixed',
  never: 'Never solved',
};

/** Rows sorted into bands, then by total solved (desc), then set (test first), then id. */
export function sortForMatrix(tasks: TaskMeta[]): TaskMeta[] {
  const g = (t: TaskMeta) => GROUP_ORDER.indexOf(groupOf(t.solved));
  return [...tasks].sort((a, b) =>
    g(a) - g(b) || b.total - a.total || (a.set === b.set ? 0 : a.set === 'test' ? -1 : 1) || a.id.localeCompare(b.id));
}

export function totalRuns(s: Summary): number {
  return s.arms.reduce((a, x) => a + x.attempts, 0);
}

/** GitHub link only for SWE-rebench test ids, whose number is the upstream PR. Fresh ids get none. */
export function githubUrl(task: Pick<TaskMeta, 'id' | 'set'>): string | null {
  if (task.set !== 'test') return null;
  const m = /^tobymao__sqlglot-(\d+)$/.exec(task.id);
  return m ? `https://github.com/tobymao/sqlglot/pull/${m[1]}` : null;
}

export const shortId = (id: string): string => id.replace(/^tobymao__sqlglot-/, '');

/** The trust card the team retitled (see BRIEF.md §2.1). */
export const WEB_LEAK_TITLE = 'We caught and measured web leaks';
export const WEB_LEAK_SOURCE_TITLE = 'Clean workspaces, one gap found and measured';
export function trustTitle(title: string): string {
  return title === WEB_LEAK_SOURCE_TITLE ? WEB_LEAK_TITLE : title;
}
export const isWebLeakCard = (title: string): boolean => title === WEB_LEAK_SOURCE_TITLE;

export function taskRunCount(t: Task): number {
  return Object.values(t.results).reduce((a, r) => a + r.runs.length, 0);
}
