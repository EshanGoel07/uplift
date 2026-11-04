import { useMemo } from 'react';
import type { Summary } from '../../data/types';
import { GRADING_STEPS } from '../../data/method';
import { GRADING_CAPTION, GRADING_STATES, gradingModel } from '../../data/gradingModel';
import { AssemblyStory } from './AssemblyStory';
import { StepSource } from './StepSource';

/** The grader, one real step at a time, in the order the code runs them. */
export function GradingStory({ summary }: { summary: Summary | null }) {
  const model = useMemo(() => gradingModel(), []);
  if (!summary) return <section id="grading" className="pub onebug" aria-busy="true" />;
  const steps = [
    { title: 'One instrument.', body: <p>Three decks, read downward: prepare the workspace, run and read the tests, then decide. Every run in every condition goes through the same nine steps.</p> },
    ...GRADING_STEPS.map((s) => ({
      title: `${s.title}.`,
      body: (
        <>
          <p>{s.detail}</p>
          <dl className="story__facts">
            <div><dt>Before</dt><dd>{s.before}</dd></div>
            <div><dt>After</dt><dd>{s.after}</dd></div>
            {s.fails && <div><dt>If this fails</dt><dd>{s.fails}</dd></div>}
          </dl>
          <StepSource source={s.source} />
        </>
      ),
    })),
  ];
  return (
    <AssemblyStory
      id="grading" sectionId="grading" eyebrow="The grader" title="How a run becomes a result."
      lead="The same steps, in the same order, for every run. If anything does not add up, the run fails closed."
      steps={steps} states={GRADING_STATES} model={model} caption={() => GRADING_CAPTION}
    />
  );
}
