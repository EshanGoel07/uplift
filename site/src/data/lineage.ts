// The research pipeline as documented in the code. Each stage names its real module; the source is
// served beside the site, and tests/unit/atlas.test.ts checks every module exists. This is a conceptual
// flow of data between stages: the arrows between stages are not function calls.

export interface Stage {
  id: string;
  name: string;
  modules: string[];
  enters: string;
  happens: string;
  leaves: string;
  validated: string;
  limit: string;
}

export const LINEAGE: Stage[] = [
  { id: 'ingest', name: 'Task ingestion', modules: ['tasks'], enters: 'The public SWE-rebench dataset', happens: 'Loads the sqlglot tasks into one task shape.', leaves: 'tasks.jsonl', validated: 'Each task must fail before its fix and pass after it, on every repeat.', limit: 'One repository only.' },
  { id: 'mine', name: 'Mining', modules: ['mine'], enters: 'sqlglot commits, April to October 2026', happens: 'Finds fix commits that link an issue, then measures which tests fail before and pass after.', leaves: 'Fresh tasks', validated: 'Failing and passing test lists are measured by running them, not trusted.', limit: 'The problem text comes from the linked issue alone.' },
  { id: 'screen', name: 'Screening', modules: ['screen'], enters: 'Candidate tasks and their tests', happens: 'Muse Spark judges whether the issue describes each required test.', leaves: 'Kept tasks and tests', validated: 'The rule was fixed before any result was seen.', limit: 'A model made these judgements.' },
  { id: 'split', name: 'Split', modules: ['split'], enters: 'Validated tasks', happens: 'A date split into dev and test, plus the fresh set.', leaves: 'split.json', validated: 'Leak checks with positive controls confirm no test-period fix is in a setup snapshot.', limit: 'The published export holds test and fresh tasks only.' },
  { id: 'generate', name: 'Configuration generation', modules: ['risk', 'generate', 'tune'], enters: 'Repository history before the cutoff', happens: 'Builds a risk map, then one model call writes guidance and a hook spec. One tuned setup reads dev results.', leaves: 'Arm folders with AGENTS.md and hooks', validated: 'Inputs are date-guarded, and tuning refuses any non-dev task.', limit: 'Generated files and the risk map are not in the published export.' },
  { id: 'workspace', name: 'Workspace', modules: ['workspace'], enters: 'Base commit and one condition', happens: 'A git archive with no history, the repo\'s own agent files removed, the setup installed.', leaves: 'One isolated workspace per run', validated: 'Agent files are excluded from the patch.', limit: 'The filesystem outside the workspace stayed readable.' },
  { id: 'agent', name: 'Agent', modules: ['runner', 'batch'], enters: 'The fixed prompt with the issue', happens: 'Muse Code runs with a step and time limit, metered through a hard-capped proxy.', leaves: 'A patch, and recorded hook messages', validated: 'Timed-out or guard-failed runs are recorded as errors, never graded.', limit: 'The 924 runs could reach the web. The network block came later.' },
  { id: 'grade', name: 'Grader', modules: ['grade'], enters: 'The patch and the hidden test patch', happens: 'Resets test files, applies hidden tests and runs pytest.', leaves: 'Resolved or not resolved', validated: 'Fails closed: results must match pytest\'s own summary.', limit: 'Pytest logs are not published.' },
  { id: 'analysis', name: 'Analysis', modules: ['analysis', 'webaudit', 'label', 'report'], enters: 'Every graded run', happens: 'A paired bootstrap over bugs, the web-exposure audit, and failure labels.', leaves: 'reports/main.md', validated: 'Refuses to proceed if a run is missing or disagrees with the screened grade.', limit: 'The five comparisons are not adjusted for multiplicity.' },
  { id: 'export', name: 'Export', modules: ['analysis'], enters: 'Runs and the cost ledger', happens: 'Writes results.json, then the site splits it into summary and task files.', leaves: 'site/public/data', validated: 'Fails if the ledger disagrees with recorded costs.', limit: 'Patches are capped at 30,000 characters and scrubbed.' },
];

/** Stage order of a module, used to lay out the module map. */
export function stageOf(name: string): number {
  const i = LINEAGE.findIndex((s) => s.modules.includes(name));
  return i < 0 ? LINEAGE.length : i;
}
