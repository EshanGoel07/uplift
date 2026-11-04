// Shared state for the "one bug to 924" story: the section (DOM) writes it, the scene in the one canvas
// reads it. The section keeps every control and all the words; the scene only draws.

import type { Arm, TaskMeta } from '../data/types';
import { requestFrame } from './sceneStore';

export const cohort = {
  tasks: [] as TaskMeta[],      // test bugs first, then fresh, as in the lattice
  arms: [] as Arm[],
  focus: 0,                     // index of the bug the story follows
  reduced: false,
  /** 0 one bug, 1 six conditions, 2 two repeats, 3 all 77 bugs, 4 all 924 runs. */
  stage: 0,
  /** DOM labels the scene positions: one per condition, then the bug's own. */
  labels: [] as (HTMLElement | null)[],
};

export function setCohortStage(stage: number): void {
  if (cohort.stage === stage) return;
  cohort.stage = stage;
  requestFrame('state');
}
