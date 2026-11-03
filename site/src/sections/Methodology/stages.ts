// The five real stages of the Uplift method. Sources: README.md, PHASE_LOG.md (Phases 0-4),
// reports/main.md and the trust cards in results.json.

export interface Stage {
  n: string;
  title: string;
  short: string;
  body: string;
  facts: string[];
  command: string;
}

export const STAGES: Stage[] = [
  {
    n: '01',
    title: 'Mine bugs',
    short: 'Past fixes become test-graded tasks',
    body: "Past bug fixes become tasks: the bug's tests fail before the fix and pass after it. The test set comes from SWE-rebench; the fresh 2026 set is mined directly from sqlglot by Uplift.",
    facts: [
      '39 test bugs (SWE-rebench, 2024) and 38 fresh bugs fixed between April and October 2026',
      'The agent sees only the linked GitHub issue',
      'Every task re-validated: its FAIL_TO_PASS tests fail before the fix and pass after',
      'Screened with a rule fixed in advance: 4 of 120 tasks dropped, 38 of 164 FAIL_TO_PASS tests excluded',
    ],
    command: 'uplift tasks load · uplift mine-fresh · uplift validate-batch',
  },
  {
    n: '02',
    title: 'Split by date',
    short: 'Setups only see the past',
    body: 'Setups may only be built from the repo as it was before the test period. A leakage check proves no test-period fix is in that snapshot, and a positive control proves the check fires.',
    facts: [
      '0 of 40 test fixes and 0 of 40 fresh fixes in the setup snapshots',
      'Positive controls: 24 of 40 dev fixes and 30 of 40 fresh fixes found at HEAD',
      'Setups tuned on dev tasks only; the code refuses any test or fresh task as tuning input',
    ],
    command: 'uplift tasks split',
  },
  {
    n: '03',
    title: 'Map risk',
    short: 'Git history shows where checks belong',
    body: 'A placement map from git history (fix frequency, churn, SZZ bug-introducing commits and co-change rules) shows which files and pairs of files deserve checks.',
    facts: [
      '4,670 commits (1,776 fixes) before the snapshot',
      'SZZ-lite over the newest 200 fixes',
      '24 co-change rules and a source→test mapping for 27 files',
    ],
    command: 'uplift risk',
  },
  {
    n: '04',
    title: 'Generate setups',
    short: 'Muse Spark writes, Uplift renders',
    body: "Muse Spark writes the tips file and a hook spec from the repo's docs, history, risk map and dated review comments. Uplift renders the hooks itself, so their format is always valid.",
    facts: [
      'Generated AGENTS.md: 13 lines citing review comments',
      'Hooks: ruff lint and format after edits, co-change warnings, and a verify step that runs related tests before finishing (at most 2 blocks)',
      'Tuned setup: Muse Spark rewrote it from dev failures only (11 lines, co-change dropped)',
      'Generic copied tips file as a control',
    ],
    command: 'paid.sh generate · paid.sh tune',
  },
  {
    n: '05',
    title: 'Run and grade',
    short: 'Two repeats through the real tests',
    body: "Muse Code runs every task under every setup twice, each time in a clean workspace with no git history and the repo's own agent files removed. Only the repo's real tests grade: FAIL_TO_PASS must pass and PASS_TO_PASS must still pass.",
    facts: [
      '77 tasks × 6 setups × 2 repeats = 924 runs, 40-step budget for every setup',
      'Test files reset before grading; parsed counts must match pytest’s summary',
      'Paired task-level bootstrap: 10,000 resamples, seed 20261101',
      'Every run metered through a hard-capped, Meta-only proxy: $21.31',
    ],
    command: 'paid.sh run-batch · uplift report',
  },
];
