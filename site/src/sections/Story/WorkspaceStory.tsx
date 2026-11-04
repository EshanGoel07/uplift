import { useMemo } from 'react';
import type { ArmId, Summary } from '../../data/types';
import { workspaceLayers } from '../../data/method';
import { WORKSPACE_STATES, workspaceModel } from '../../data/models';
import { atlas, useAtlas } from '../../state/atlasStore';
import { condStyle } from '../../utils/condition';
import { AssemblyStory } from './AssemblyStory';
import { useFeaturedTask } from './useFeaturedTask';

/** One run's workspace, taken apart: what every run shares and what a condition really added. */
export function WorkspaceStory({ summary }: { summary: Summary | null }) {
  const arm: ArmId = useAtlas((s) => s.condition) ?? 'both';
  const task = useFeaturedTask('workspace', !!summary);
  const model = useMemo(() => workspaceModel(arm, task), [arm, task]);
  const added = workspaceLayers(arm).filter((l) => l.kind === 'setup');
  if (!summary) return <section id="workspace" className="pub onebug" aria-busy="true" />;
  const label = summary.arms.find((a) => a.id === arm)?.label ?? arm;

  const steps = [
    { title: 'One run\'s workspace.', body: <p>Every run gets its own closed workspace: the repository, what the agent was told, and Muse Code. This is the repository the WINDOW bug started from.</p> },
    { title: 'Taken apart.', body: <p>The code comes from the bug's base commit, in a fresh folder. Its git history and the repository's own agent files are removed, so past fixes cannot be looked up.</p> },
    { title: 'The issue.', body: <p>The linked GitHub issue goes into the same fixed prompt for every condition. It is the agent's whole statement of the problem.</p> },
    {
      title: 'The setup.',
      body: added.length
        ? <p>{label} adds {added.map((l) => l.title).join(' and ')}. This is the only thing that differs between conditions.</p>
        : <p>{label} adds nothing. The baseline runs on the code and the issue alone.</p>,
    },
    { title: 'Muse Code runs.', body: <p>The parts close into one workspace and Muse Code works inside it, with at most 40 model steps and 2,400 seconds. Network access was not blocked in the 924 runs.</p> },
    { title: 'The patch.', body: <p>When the agent stops, its changes are recorded as a diff. Shown here is the real diff from this condition's first run on the WINDOW bug.</p> },
  ];

  return (
    <AssemblyStory
      id="workspace" sectionId="workspace" eyebrow="Inside one run" title="What the agent worked in."
      lead="Select any object to see what it is and where it comes from."
      steps={steps} states={WORKSPACE_STATES} model={model} controlsAt={3}
      controls={(
        <div className="lens-conds" role="group" aria-label="Condition shown in this model">
          {summary.arms.map((a) => (
            <button key={a.id} type="button" className="lens-cond" style={condStyle(a.id)} aria-pressed={arm === a.id} onClick={() => atlas.set({ condition: a.id as ArmId })}>
              <i aria-hidden="true" />{a.label}
            </button>
          ))}
        </div>
      )}
    />
  );
}
