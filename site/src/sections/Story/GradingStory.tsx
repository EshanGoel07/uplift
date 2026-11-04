import { useMemo } from 'react';
import type { Summary } from '../../data/types';
import { GRADING_STEPS } from '../../data/method';
import { GRADING_STATES, gradingModel } from '../../data/gradingModel';
import { AssemblyStory } from './AssemblyStory';

/** The grader, one real step at a time, in the order the code runs them. */
export function GradingStory({ summary }: { summary: Summary | null }) {
  const model = useMemo(() => gradingModel(), []);
  if (!summary) return <section id="grading" className="pub onebug" aria-busy="true" />;
  const steps = GRADING_STEPS.map((s) => ({ title: `${s.title}.`, body: <p>{s.detail}</p> }));
  return (
    <AssemblyStory
      id="grading" sectionId="grading" eyebrow="The grader" title="How a run becomes a result."
      lead="The same steps, in the same order, for every run. If anything does not add up, the run fails closed."
      steps={steps} states={GRADING_STATES} model={model}
    />
  );
}
