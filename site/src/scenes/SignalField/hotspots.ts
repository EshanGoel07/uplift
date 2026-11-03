import type { Summary } from '../../data/types';

export interface Hotspot { value: string; label: string; detail: string }

/** Floating counters around the Signal Field. Values come from summary.json. */
export function heroHotspots(s: Summary | null): Hotspot[] {
  const test = s ? s.tasks.filter((t) => t.set === 'test').length : 39;
  const fresh = s ? s.tasks.filter((t) => t.set === 'fresh').length : 38;
  const arms = s ? s.arms.length : 6;
  return [
    { value: String(test), label: 'Test bugs',
      detail: `${test} past sqlglot bugs from SWE-rebench. The agent sees only the GitHub issue; the repo's real tests grade the fix.` },
    { value: String(fresh), label: 'Fresh 2026 bugs',
      detail: `${fresh} bugs fixed in sqlglot between April and October 2026, mined from the repo by Uplift.` },
    { value: String(arms * 2), label: 'Runs per bug',
      detail: `${arms} setups × 2 repeats. Every bug gets the same ${arms * 2} attempts, so setups are compared on the same bugs (paired).` },
    { value: '2', label: 'Meta models',
      detail: 'Muse Code is the agent under test. Muse Spark generated the setups, tuned one, and labelled failures. No other models.' },
  ];
}
