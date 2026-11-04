// Shared state for the "one bug to 924" story: the section (DOM) writes it, the scene in the one canvas
// reads it. The section keeps every control and all the words; the scene only draws.

import type { Arm, TaskMeta } from '../data/types';
import { requestFrame } from './sceneStore';

export interface CohortStep {
  /** How many of the six conditions have been introduced. */
  lanes: number;
  /** Every condition shown with its two repeat markers. */
  repeats: boolean;
  /** The view has pulled back to all 77 bugs. */
  cohort: boolean;
}

export const cohort = {
  tasks: [] as TaskMeta[],      // test bugs first, then fresh, as in the lattice
  arms: [] as Arm[],
  focus: 0,                     // index of the bug the story follows
  reduced: false,
  step: { lanes: 0, repeats: false, cohort: false } as CohortStep,
};

export function setCohortStep(step: CohortStep): void {
  const s = cohort.step;
  if (s.lanes === step.lanes && s.repeats === step.repeats && s.cohort === step.cohort) return;
  cohort.step = step;
  requestFrame('state');
}
