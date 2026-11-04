import { useMemo } from 'react';
import type { ArmId, Summary } from '../../data/types';
import { NETWORK_NOTE } from '../../data/method';
import { CUTAWAY_STATES, cutawayModel } from '../../data/models';
import { useAtlas } from '../../state/atlasStore';
import { AssemblyStory } from './AssemblyStory';
import { useFeaturedTask } from './useFeaturedTask';

const PHASE = ['Phase A · Agent working', 'Phase A · Agent working', 'The agent exits', 'Phase B · Agent has exited', 'Phase B · Agent has exited', 'Phase B · Agent has exited'];

/** One workspace over time: what the agent worked with, and what arrived only after it had gone. */
export function CutawayStory({ summary }: { summary: Summary | null }) {
  const arm: ArmId = useAtlas((s) => s.condition) ?? 'both';
  const task = useFeaturedTask('cutaway', !!summary);
  const model = useMemo(() => cutawayModel(arm, task), [arm, task]);
  if (!summary) return <section id="cutaway" className="pub onebug" aria-busy="true" />;
  const label = summary.arms.find((a) => a.id === arm)?.label ?? arm;
  const run = task?.results[arm]?.runs[0];

  const steps = [
    { title: 'One workspace.', body: <p>The code at the bug's base commit with no history, the issue in a fixed prompt, and the setup of {label}. Everything here stays in this one workspace until the run ends.</p> },
    { title: 'Agent working.', body: <><p>Muse Code works with what is in the workspace. The hidden tests are not there: they sit on the timeline, at a moment after the agent has gone.</p><p className="story__note">{NETWORK_NOTE}</p></> },
    { title: 'The agent exits.', body: <p>Muse Code stops and does not run again. Its changes are recorded as a patch, and the workspace stays exactly as it left it.</p> },
    { title: 'Hidden tests arrive.', body: <p>Only now are the real fix's tests applied, in the same workspace. The agent cannot react to them, because it has exited.</p> },
    { title: 'Grading begins.', body: <p>The evaluator runs pytest in that workspace, with the workspace's own interpreter. The next section takes this procedure apart.</p> },
    { title: 'The result.', body: <p>Resolved or not resolved. Nothing else is scored, and the agent never learns which.{run ? ` For ${label}, first repeat on the WINDOW bug: ${run.resolved ? 'resolved' : 'not resolved'}.` : ''}</p> },
  ];

  return (
    <AssemblyStory
      id="cutaway" sectionId="cutaway" eyebrow="Agent and evaluator" title="What the agent could not see."
      lead="This is a conceptual model. The real separation is timing: hidden tests reach the workspace only after the agent has exited."
      steps={steps} states={CUTAWAY_STATES} model={model} caption={(s) => PHASE[s]}
    />
  );
}
