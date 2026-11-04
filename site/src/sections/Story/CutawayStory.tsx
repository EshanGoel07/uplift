import { useMemo } from 'react';
import type { Summary } from '../../data/types';
import { CUTAWAY_STATES, cutawayModel } from '../../data/models';
import { AssemblyStory } from './AssemblyStory';

/** What the agent could see, and what it could not: a conceptual cutaway of the information barrier. */
export function CutawayStory({ summary }: { summary: Summary | null }) {
  const model = useMemo(() => cutawayModel(), []);
  if (!summary) return <section id="cutaway" className="pub onebug" aria-busy="true" />;

  const steps = [
    { title: 'What the agent receives.', body: <p>The code at the bug's base commit with no history, the issue in a fixed prompt, and its condition's setup. Nothing else is handed to it.</p> },
    { title: 'What stays hidden.', body: <p>The real fix's tests never appear on the agent's side. It does not see the FAIL_TO_PASS or PASS_TO_PASS lists, other conditions' runs, or whether its run counted.</p> },
    { title: 'What the agent produces.', body: <p>The agent edits the code and stops. Its changes are recorded as a patch.</p> },
    { title: 'The workspace crosses.', body: <p>The agent has exited, so nothing can reach it now. Grading runs in the same workspace it left, which is why only now are the hidden tests applied.</p> },
    { title: 'The tests run.', body: <p>Pytest runs in that workspace. The next section takes this step apart.</p> },
    { title: 'The result.', body: <p>Each run ends as resolved or not resolved. Nothing else is scored, and the agent never learns which.</p> },
  ];

  return (
    <AssemblyStory
      id="cutaway" sectionId="cutaway" eyebrow="Agent and evaluator" title="What the agent could not see."
      lead="This is a conceptual model. The real separation is timing: hidden tests reach the workspace only after the agent has exited."
      steps={steps} states={CUTAWAY_STATES} model={model}
    />
  );
}
