import { useMemo, useState } from 'react';
import type { ArmId, Summary } from '../../data/types';
import { workspaceLayers } from '../../data/method';
import { WORKSPACE_STATES, workspaceModel } from '../../data/models';
import { condStyle } from '../../utils/condition';
import { AssemblyStory } from './AssemblyStory';

/** One run's workspace, taken apart: what every run shares and what a condition really added. */
export function WorkspaceStory({ summary }: { summary: Summary | null }) {
  const [arm, setArm] = useState<ArmId>('both');
  const model = useMemo(() => workspaceModel(arm), [arm]);
  const added = workspaceLayers(arm).filter((l) => l.kind === 'setup');
  if (!summary) return <section id="workspace" className="pub onebug" aria-busy="true" />;
  const label = summary.arms.find((a) => a.id === arm)?.label ?? arm;

  const steps = [
    { title: 'A clean snapshot.', body: <p>Each run starts from the bug's base commit in a fresh folder. Its git history and the repository's own agent files are removed, so past fixes cannot be looked up.</p> },
    { title: 'The issue.', body: <p>The linked GitHub issue goes into the same fixed prompt for every condition. It is the agent's whole statement of the problem.</p> },
    {
      title: 'The setup.',
      body: added.length
        ? <p>{label} adds {added.map((l) => l.title).join(' and ')}. This is the only thing that differs between conditions.</p>
        : <p>{label} adds nothing. The baseline runs on exactly the layers below it.</p>,
    },
    { title: 'The working environment.', body: <p>The layers close into one workspace and Muse Code runs inside it, with at most 40 model steps and 2,400 seconds. Network access was not blocked in the 924 runs.</p> },
    { title: 'The patch.', body: <p>When the agent stops, its changes are recorded as a diff. This model explains the structure of a run; it is not a recording of one.</p> },
  ];

  return (
    <AssemblyStory
      id="workspace" sectionId="workspace" eyebrow="Inside one run" title="What the agent worked in."
      lead="Select any layer to see what it is and where it comes from, or change the condition to see what it really installed."
      steps={steps} states={WORKSPACE_STATES} model={model}
      controls={(
        <div className="lens-conds" role="group" aria-label="Condition shown in this model">
          {summary.arms.map((a) => (
            <button key={a.id} type="button" className="lens-cond" style={condStyle(a.id)} aria-pressed={arm === a.id} onClick={() => setArm(a.id)}>
              <i aria-hidden="true" />{a.label}
            </button>
          ))}
        </div>
      )}
    />
  );
}
