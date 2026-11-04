// Shared state for the "one bug to 924" story: the section (DOM) writes it, the scene in the one canvas
// reads it. The section keeps every control and all the words; the scene only draws.

import type { Arm, TaskMeta } from '../data/types';
import { requestFrame } from './sceneStore';

/** The story's states, in order. The active step is the one source: text, labels and scene all follow it. */
export const STORY_STATES = ['single-bug', 'six-conditions', 'two-repeats', 'every-bug', 'full-atlas'] as const;
export type StoryState = (typeof STORY_STATES)[number];

export const cohort = {
  tasks: [] as TaskMeta[],      // test bugs first, then fresh, as in the lattice
  arms: [] as Arm[],
  focus: 0,                     // index of the bug the story follows
  reduced: false,
  /** Index into STORY_STATES. */
  stage: 0,
  /** What the scene has reached: the state it last settled on, and its camera framing. Read by diagnostics. */
  settledAt: -1,
  view: -1,
  /** DOM labels the scene positions: one per condition, then the bug's own. */
  labels: [] as (HTMLElement | null)[],
};

export function setCohortStage(stage: number): void {
  if (cohort.stage === stage) return;
  cohort.stage = stage;
  cohort.settledAt = -1;
  requestFrame('state');
}
