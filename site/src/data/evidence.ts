// The Evidence and Provenance Ledger. Each entry states one claim the site makes, where it comes from
// and how far a reader can follow it. Paths are repository paths; tests/unit/atlas.test.ts checks that
// every one exists. 'audited' means the figure is in a published report but its raw artifact is not.

export type EvidenceStatus = 'published' | 'audited' | 'unavailable';

export interface Evidence {
  id: string;
  claim: string;
  status: EvidenceStatus;
  source: string;
  path: string | null;
  /** Report heading or code symbol to look for. */
  anchor?: string;
  note?: string;
}

export const STATUS_LABEL: Record<EvidenceStatus, string> = {
  published: 'Published source',
  audited: 'Audited source',
  unavailable: 'Unavailable',
};

export const EVIDENCE: Evidence[] = [
  { id: 'E01', claim: '924 runs: 77 bugs × 6 conditions × 2 repeats.', status: 'published', source: 'Public results export', path: 'site/public/data/results.json', note: 'Recounted from the run records by tests/unit/data.test.ts.' },
  { id: 'E02', claim: '43 bugs always solved, 23 mixed, 11 never solved.', status: 'published', source: 'Derived from the run records', path: 'site/public/data/summary.json' },
  { id: 'E03', claim: 'Solve totals: 112, 112, 111, 111, 107 and 113 of 154.', status: 'published', source: 'Public results export', path: 'site/public/data/results.json' },
  { id: 'E04', claim: 'Every paired 95% interval crosses zero.', status: 'published', source: 'Paired bootstrap in the report', path: 'reports/main.md', anchor: 'Paired difference vs no setup' },
  { id: 'E05', claim: 'Detectable effect of 5.4–9.1 points at 80% power.', status: 'published', source: 'Report table', path: 'reports/main.md', anchor: 'Paired difference vs no setup' },
  { id: 'E06', claim: 'Sensitivity views: the conclusion holds without exposed tasks.', status: 'audited', source: 'Web access section of the report', path: 'reports/main.md', anchor: 'Web access: a leak the snapshot checks could not see', note: 'The per-run audit file is not published; the report publishes the totals and the recomputed intervals.' },
  { id: 'E07', claim: '80 of 924 runs reached the real fix or newer upstream code.', status: 'audited', source: 'Web access section of the report', path: 'reports/main.md', anchor: 'Web access: a leak the snapshot checks could not see', note: 'The classification logic is public in src/uplift/webaudit.py. The agent traces it read are not.' },
  { id: 'E08', claim: 'Agents now run with the network blocked; the 924 runs were not re-run.', status: 'published', source: 'Engineering log and runner code', path: 'PHASE_LOG.md', note: 'The block is in src/uplift/runner.py (NETWORK_ARGS).' },
  { id: 'E09', claim: 'The grader fails closed.', status: 'published', source: 'Grader source', path: 'src/uplift/grade.py', anchor: 'check_output' },
  { id: 'E10', claim: 'The agent sees only the issue, the code and its setup.', status: 'published', source: 'Runner source', path: 'src/uplift/runner.py', anchor: 'PROMPT' },
  { id: 'E11', claim: 'Workspaces start from a snapshot with no git history.', status: 'published', source: 'Workspace source', path: 'src/uplift/workspace.py', anchor: 'create' },
  { id: 'E12', claim: 'Tuning used dev tasks only.', status: 'published', source: 'Tuning source', path: 'src/uplift/tune.py', anchor: 'assert_dev_only' },
  { id: 'E13', claim: 'WINDOW approaches: 7 shortcut, 4 look-ahead, 1 other.', status: 'published', source: 'README worked example, checked against the diffs', path: 'README.md', note: 'A hand classification; tests/unit/data.test.ts re-derives it from the published diffs.' },
  { id: 'E14', claim: 'The generic tips file condition.', status: 'published', source: 'The file itself', path: 'arms/handwritten/AGENTS.md' },
  { id: 'E15', claim: 'Generated AGENTS.md and hook files.', status: 'unavailable', source: 'Generated into local working data that is not published', path: null, note: 'The generator (src/uplift/generate.py) is public; its outputs for this study are not. Delivered hook messages are published per run.' },
  { id: 'E16', claim: 'Agent traces, exit details, timestamps and pytest logs.', status: 'unavailable', source: 'Local run folders, not published', path: null },
  { id: 'E17', claim: 'sqlglot commit history, risk map and co-change rules.', status: 'unavailable', source: 'Local working data, not published', path: null, note: 'Only co-change warnings delivered to agents appear, inside hook messages.' },
  { id: 'E18', claim: 'Main experiment cost of $21.31.', status: 'published', source: 'Public results export', path: 'site/public/data/results.json', note: 'The export refuses to run if it disagrees with the cost ledger (src/uplift/analysis.py). The ledger file itself is not published.' },
];

export const evidenceById = (id: string): Evidence | undefined => EVIDENCE.find((e) => e.id === id);
