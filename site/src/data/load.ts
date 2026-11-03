import type { Summary, Task } from './types';

// import.meta.env.BASE_URL is './' (see vite.config.ts), so these resolve under any sub-path.
const base = (): string => (import.meta.env?.BASE_URL ?? './');

export const dataUrl = (path: string): string => `${base()}data/${path}`;

let summaryPromise: Promise<Summary> | null = null;
export function loadSummary(): Promise<Summary> {
  summaryPromise ??= fetch(dataUrl('summary.json')).then((r) => {
    if (!r.ok) throw new Error(`summary.json: HTTP ${r.status}`);
    return r.json() as Promise<Summary>;
  });
  return summaryPromise;
}

// Task files are fetched only when a task is opened, then cached.
const taskCache = new Map<string, Promise<Task>>();
export function loadTask(id: string): Promise<Task> {
  let p = taskCache.get(id);
  if (!p) {
    p = fetch(dataUrl(`tasks/${encodeURIComponent(id)}.json`)).then((r) => {
      if (!r.ok) throw new Error(`task ${id}: HTTP ${r.status}`);
      return r.json() as Promise<Task>;
    });
    p.catch(() => taskCache.delete(id));
    taskCache.set(id, p);
  }
  return p;
}
