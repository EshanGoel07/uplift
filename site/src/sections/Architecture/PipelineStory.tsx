import { LINEAGE, PIPELINE } from '../../data/lineage';
import { useMedia, WIDE } from '../../hooks/useMedia';
import { StoryScroller } from '../../components/story/StoryScroller';

const stagesOf = (ids: string[]) => ids.map((id) => LINEAGE.find((s) => s.id === id)!);
const modulesOf = (ids: string[]) => [...new Set(stagesOf(ids).flatMap((s) => s.modules))];

/** Opens one module in the source explorer below. */
function inspect(name: string) {
  window.dispatchEvent(new CustomEvent('uplift:module', { detail: name }));
  document.getElementById('source-explorer')?.scrollIntoView({ block: 'start' });
}

const Modules = ({ ids }: { ids: string[] }) => (
  <p className="pipe__mods">{modulesOf(ids).map((m) => <button key={m} type="button" className="file-chip linkish" onClick={() => inspect(m)}>{m}.py</button>)}</p>
);

/** The study's engineering, as five stages in order. The real modules, inputs and limits come from the lineage data. */
export function PipelineStory() {
  const wide = useMedia(WIDE);
  const steps = PIPELINE.map((p) => {
    const stages = stagesOf(p.stages);
    return {
      title: `${p.name}.`,
      body: (
        <>
          <p>{p.purpose}</p>
          <dl className="story__facts">
            <div><dt>Enters</dt><dd>{stages[0].enters}</dd></div>
            <div><dt>Leaves</dt><dd>{stages[stages.length - 1].leaves}</dd></div>
            <div><dt>Checked by</dt><dd>{stages[0].validated}</dd></div>
            <div><dt>Limit</dt><dd>{stages[stages.length - 1].limit}</dd></div>
          </dl>
          <Modules ids={p.stages} />
        </>
      ),
    };
  });
  return (
    <StoryScroller
      label="The pipeline in five stages"
      steps={steps}
      sticky={wide}
      states={PIPELINE.map((p) => p.id)}
      stage={(active) => (
        <ol className="pipe" aria-hidden="true">
          {PIPELINE.map((p, i) => (
            <li key={p.id} className={`pipe__stage${i === active ? ' is-on' : ''}${i < active ? ' is-past' : ''}`}>
              <span className="pipe__n">{i + 1}</span>
              <strong>{p.name}</strong>
              <span className="pipe__files">{modulesOf(p.stages).map((m) => `${m}.py`).join('  ')}</span>
            </li>
          ))}
          <li className={`pipe__loop${active === 2 || active === 3 ? ' is-on' : ''}`}>Documented data flow: dev results from stage 4 feed the tuned setup in stage 3, once.</li>
        </ol>
      )}
    />
  );
}
