import type { ArmId } from './types';

/** What each setup is (BRIEF.md §3.2, PHASE_LOG.md Phase 2 and 4). Display labels come from the data. */
export const ARM_INFO: Record<ArmId, { short: string; detail: string }> = {
  none: {
    short: 'Baseline',
    detail: "The repo with its own CLAUDE.md and AGENTS.md removed (sqlglot added them in 2026), so “none” really is none.",
  },
  prose: {
    short: 'AGENTS.md',
    detail: 'A 13-line AGENTS.md written by Muse Spark from the repo’s docs, commit history, risk map and 150 dated code-review comments, all from before the test period.',
  },
  sensors: {
    short: 'Hooks',
    detail: 'Checks that run while the agent works: ruff lint and format on edited files, co-change warnings, and a verify step at the end that runs related tests and can block finishing (at most twice).',
  },
  both: {
    short: 'AGENTS.md + hooks',
    detail: 'The generated tips file and the generated hooks together.',
  },
  handwritten: {
    short: 'Control',
    detail: 'A generic best-practice AGENTS.md, written by us in the style commonly shared online and not specific to the repo: the control for “use a generic setup”.',
  },
  tuned: {
    short: 'Hypothesis',
    detail: 'Muse Spark read failures on dev tasks only and rewrote the setup: an 11-line AGENTS.md, lint and verify kept, co-change dropped. Chosen from one-repeat dev differences, so a hypothesis, not a proven improvement.',
  },
};

export const ARM_ORDER: ArmId[] = ['none', 'prose', 'sensors', 'both', 'handwritten', 'tuned'];
