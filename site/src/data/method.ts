// The one authoritative description of HOW the experiment ran, for the workbench (Methodology).
//
// Counts and outcomes always come from summary.json / task files. This file holds the structural
// facts that results.json does not carry, each with the repository source it was read from, so the
// workbench never invents a step. Paths are relative to the repo root.

import type { ArmId } from './types';

/** src/uplift/runner.py, PROMPT: the agent's entire instruction; {problem} is the GitHub issue text. */
export const AGENT_PROMPT = `You are working in a Python repository. Fix the issue below so the code behaves as described.

Rules:
- Change the library code to fix the issue. Do not edit or delete existing tests (you may add new ones).
- Keep the change minimal and consistent with the surrounding code.
- When you're done, stop.

<issue>
{problem}
</issue>`;

/** src/uplift/workspace.py, AGENT_PATHS: the repo's own agent files, removed before a setup is installed. */
export const STRIPPED_AGENT_FILES = ['AGENTS.md', 'CLAUDE.md', '.muse', '.claude', '.cursorrules', '.cursor', '.github/copilot-instructions.md'];

/** src/uplift/workspace.py (create, install_arm) and runner.py: how one run's workspace is built. */
export const WORKSPACE_STEPS: { title: string; detail: string }[] = [
  { title: 'Snapshot, no history', detail: 'git archive of the task\'s base commit into a fresh folder, then git init and one "start" commit. The agent cannot read the repo\'s past, so it cannot find the fix in later commits.' },
  { title: 'Own agent files removed', detail: `The repository's own ${STRIPPED_AGENT_FILES.slice(0, 2).join(' and ')} (and ${STRIPPED_AGENT_FILES.length - 2} other agent paths) are deleted, so "No setup" really has none.` },
  { title: 'Assigned setup installed', detail: 'Only this condition\'s files are copied in and committed: an AGENTS.md, the hook files, both, or nothing.' },
  { title: 'Own environment', detail: 'A private .venv (uv, Python 3.12) with the package and pytest. The Muse sandbox keeps the hook folder read-only to the agent.' },
  { title: 'Agent run', detail: 'muse exec --trust-workspace --disable-approval, at most 40 model steps and 2,400 s, every call metered through the budget proxy.' },
];

/** src/uplift/grade.py (grade, reset_test_files, check_output) and screen.py (resolved). */
export const GRADING_STEPS: { title: string; detail: string }[] = [
  { title: 'Check the run finished', detail: 'A run that hit an infrastructure failure is kept out of grading. It is not scored as a failed attempt.' },
  { title: 'Reset the test files', detail: 'The files in the task\'s test patch go back to the base commit. Grading runs in the agent\'s own workspace, after it has exited.' },
  { title: 'Apply the hidden tests', detail: 'The real fix\'s test patch, which was never in the agent\'s workspace, is applied now. If it cannot apply, the run is not resolved.' },
  { title: 'Clear stale bytecode', detail: 'Every __pycache__ folder outside .venv is deleted, so old compiled code cannot answer for the new source.' },
  { title: 'Run pytest', detail: 'The test files run with the workspace\'s own interpreter and an isolated pytest config, with a 900-second limit.' },
  { title: 'Parse each test', detail: 'Per-test results are read from pytest\'s -rA output.' },
  { title: 'Cross-check the counts', detail: 'Parsed passed, failed and error counts must match pytest\'s own summary line. On any mismatch every test counts as failed.' },
  { title: 'Check both test lists', detail: 'Every FAIL_TO_PASS test must now pass, and every PASS_TO_PASS test must still pass.' },
  { title: 'Record the verdict', detail: 'Resolved or not resolved, ignoring FAIL_TO_PASS tests that screening excluded before any result was seen.' },
];

/** screen.resolved: the definition of a solved run. */
export const RESOLVED_RULE = 'Resolved = every kept FAIL_TO_PASS test passes and every PASS_TO_PASS test still passes.';

/** One layer of an isolated workspace, for the exploded view. */
export interface WorkspaceLayer { id: string; title: string; detail: string; source: string; kind: 'base' | 'setup' | 'output' }

/**
 * The real make-up of one run's workspace (workspace.py create and install_arm, runner.py). Optional
 * layers appear only for a condition that had them: No setup has neither guidance nor hooks.
 */
export function workspaceLayers(arm: ArmId): WorkspaceLayer[] {
  const c = CONDITIONS[arm];
  const out: WorkspaceLayer[] = [
    { id: 'snapshot', title: 'Repository snapshot', detail: 'A git archive of the task\'s base commit, unpacked into a fresh folder.', source: 'src/uplift/workspace.py', kind: 'base' },
    { id: 'history', title: 'Git history removed', detail: 'The folder is a new repository with one commit, so past fixes cannot be looked up in it.', source: 'src/uplift/workspace.py', kind: 'base' },
    { id: 'cleanup', title: 'Original agent files removed', detail: `The repository's own ${STRIPPED_AGENT_FILES.slice(0, 2).join(' and ')} and similar files are deleted before any setup is installed.`, source: 'src/uplift/workspace.py', kind: 'base' },
    { id: 'issue', title: 'Issue input', detail: 'The linked GitHub issue, inserted into the same fixed prompt for every condition.', source: 'src/uplift/runner.py', kind: 'base' },
  ];
  if (c.hasTips) out.push({ id: 'agents', title: arm === 'handwritten' ? 'AGENTS.md (handwritten)' : 'AGENTS.md (generated)', detail: c.receives[0], source: arm === 'handwritten' ? 'arms/handwritten/AGENTS.md' : 'src/uplift/generate.py', kind: 'setup' });
  if (c.hasHooks) out.push({ id: 'hooks', title: 'Hook configuration', detail: 'Hooks that run while the agent works, under .muse/, delivering messages back to it.', source: 'src/uplift/arm_hooks/uplift_hook.py', kind: 'setup' });
  out.push({ id: 'agent', title: 'Muse Code execution', detail: 'muse exec with at most 40 model steps and 2,400 seconds. Network access was not blocked in the 924 runs.', source: 'src/uplift/runner.py', kind: 'output' });
  out.push({ id: 'patch', title: 'Produced patch', detail: 'The diff of the agent\'s changes, excluding agent files. It is recorded when the agent stops.', source: 'src/uplift/workspace.py', kind: 'output' });
  return out;
}

/** What crosses the information barrier in each direction (runner.py, grade.py). */
export const AGENT_SEES = [
  { k: 'Repository snapshot', v: 'The code at the bug\'s base commit, with no git history.' },
  { k: 'Task issue', v: 'The linked GitHub issue text, inserted into the prompt.' },
  { k: 'Task prompt', v: 'The fixed instruction below, the same for every condition.' },
  { k: 'Assigned setup', v: 'This condition\'s AGENTS.md and/or hooks, if any.' },
  { k: 'Runtime feedback', v: 'Hook messages while it works (hook conditions only).' },
];
export const EVALUATOR_SEES = [
  { k: 'The agent\'s workspace', v: 'Graded where the agent left it, after it has exited.' },
  { k: 'FAIL_TO_PASS tests', v: 'The bug\'s own tests from the real fix: fail before, must pass after.' },
  { k: 'PASS_TO_PASS tests', v: 'Existing tests that must still pass (regressions).' },
  { k: 'Pytest output', v: 'Checked against pytest\'s summary line.' },
  { k: 'Classification', v: 'Resolved or not resolved. Nothing else is scored.' },
];
/** The agent never receives these. */
export const HIDDEN_FROM_AGENT = ['The real fix and its test patch', 'The FAIL_TO_PASS / PASS_TO_PASS test lists', 'Other conditions\' runs', 'Whether its run counted as resolved'];

/** README "Notes" and PHASE_LOG Phase 5-6: the honest caveat about the agent side of the 924 runs. */
export const NETWORK_NOTE = 'In the 924 runs the agent could still reach the web; the audit found 80 runs that saw the fix or newer code, and the result holds without them. New runs are network-blocked.';

/** split.py (make_split), mine.py, PHASE_LOG Phase 1a-1c and 4: where the tasks come from. */
export const TASK_SOURCES = {
  test: { name: 'Test tasks', origin: 'SWE-rebench', detail: 'The newest SWE-rebench sqlglot tasks (2024 bugs), validated and screened. The id number is the upstream pull request.' },
  fresh: { name: 'Fresh tasks', origin: 'Mined by Uplift', detail: 'Bugs fixed in sqlglot between April and October 2026 whose commit links a GitHub issue. The agent sees only that issue.' },
  dev: { name: 'Dev tasks', origin: 'SWE-rebench', count: 40, detail: 'The 40 SWE-rebench tasks just before the test window. Used only to tune one setup and for ablations; never part of the 924 runs, and the code refuses them as test inputs.' },
};

/** analysis.py (bootstrap): how the comparison is computed. */
export const ANALYSIS_STEPS = [
  'Each bug and condition gets a score: the share of its 2 runs that were resolved (0, ½ or 1).',
  'A condition is compared with No setup bug by bug, on the same 77 bugs.',
  'Paired bootstrap: resample the 77 bugs 10,000 times (seed 20261101), recompute each difference, take the middle 95%.',
];

/**
 * What each condition physically adds to the workspace. Labels and one-line descriptions come from
 * results.json; these are the contents. Sources: generate.py (ARMS), tune.py,
 * arms/handwritten/AGENTS.md, arm_hooks/uplift_hook.py, PHASE_LOG Phases 2 and 4.
 */
export interface ConditionSpec {
  hasTips: boolean;
  hasHooks: boolean;
  receives: string[];
  notReceives: string[];
  files: string[];
  /** Lines in this condition's AGENTS.md, where it has one. */
  agentsLines?: number;
  /** The checks its hooks run (generate.py ARMS, tune.py). */
  hookChecks?: string[];
  why: string;
}
const HOOK_FILES = ['.muse/hooks.json', '.muse/uplift_hooks/uplift_hook.py', '.muse/uplift_hooks/config.json'];
export const CONDITIONS: Record<ArmId, ConditionSpec> = {
  none: {
    hasTips: false, hasHooks: false,
    receives: ['The issue and the code, nothing else'],
    notReceives: ['Any AGENTS.md', 'Any hooks', 'The repository\'s own CLAUDE.md / AGENTS.md (removed)'],
    files: [],
    why: 'The baseline every other condition is compared with.',
  },
  prose: {
    hasTips: true, hasHooks: false, agentsLines: 13,
    receives: ['A 13-line AGENTS.md written by Muse Spark from the repo\'s docs, commit history, risk map and 150 dated review comments, all from before the test period'],
    notReceives: ['Hooks or any runtime feedback'],
    files: ['AGENTS.md'],
    why: 'Does repo-specific written guidance help?',
  },
  sensors: {
    hasTips: false, hasHooks: true, hookChecks: ['lint', 'cochange', 'verify'],
    receives: ['After each edit: ruff lint and format checks, and co-change warnings from git history', 'Before stopping: a verify step runs related tests and can block finishing (at most twice)'],
    notReceives: ['Any AGENTS.md'],
    files: HOOK_FILES,
    why: 'Does feedback while the agent works help?',
  },
  both: {
    hasTips: true, hasHooks: true, agentsLines: 13, hookChecks: ['lint', 'cochange', 'verify'],
    receives: ['The generated AGENTS.md', 'The generated hooks'],
    notReceives: ['Nothing beyond the two generated setups'],
    files: ['AGENTS.md', ...HOOK_FILES],
    why: 'Do the two together help more than either?',
  },
  handwritten: {
    hasTips: true, hasHooks: false, agentsLines: 60,
    receives: ['A 60-line generic best-practice AGENTS.md, written by us in the style commonly shared online (arms/handwritten/AGENTS.md)'],
    notReceives: ['Anything specific to sqlglot', 'Hooks'],
    files: ['AGENTS.md'],
    why: 'Does a generic, non-repo-specific setup help?',
  },
  tuned: {
    hasTips: true, hasHooks: true, agentsLines: 11, hookChecks: ['lint', 'verify'],
    receives: ['An 11-line AGENTS.md and hooks (lint and verify) rewritten by Muse Spark after reading dev-task results only'],
    notReceives: ['Co-change hooks (dropped by the tuning)', 'Any test or fresh task information (the code refuses it)'],
    files: ['AGENTS.md', ...HOOK_FILES],
    why: 'Does one round of tuning on separate dev tasks help? A hypothesis, chosen from one-repeat dev differences.',
  },
};
