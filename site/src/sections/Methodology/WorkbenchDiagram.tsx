import type { Summary, TaskMeta } from '../../data/types';
import { shortId } from '../../data/classify';
import { CONDITIONS } from '../../data/method';
import { sideOf, wb, useWb, type Focus } from '../../state/workbenchStore';
import { condStyle } from '../../utils/condition';

interface Props { summary: Summary; tasks: TaskMeta[] }

const go = (focus: Focus) => wb.set({ focus });

/**
 * The workbench as an accessible HTML schematic: the same modules, lanes, runs and barrier as the 3D
 * model, every part a real button. Rows are conditions; the selected bug's real outcomes fill them.
 */
export function WorkbenchDiagram({ summary, tasks }: Props) {
  const idx = useWb((s) => s.task);
  const focus = useWb((s) => s.focus);
  const side = sideOf(focus);
  const runs = useWb((s) => s.runs);
  const t = tasks[idx];
  const arms = summary.arms;
  const nTest = tasks.filter((x) => x.set === 'test').length;
  const repeats = Math.round(arms[0].attempts / tasks.length);
  const none = t.solved.none / repeats;
  const laneOn = (i: number) => (focus.kind === 'lane' || focus.kind === 'run') && arms[i].id === focus.arm;

  return (
    <div className={`wbd is-${side}`} role="group" aria-label="Workbench diagram">
      <div className="wbd__source">
        <button type="button" className="wbd__module" aria-pressed={focus.kind === 'source' && focus.group === 'main'} onClick={() => go({ kind: 'source', group: 'main' })}>
          <span className="wbd__k">A · Task source</span>
          <span className="wbd__big">{tasks.length} bugs</span>
          <span className="wbd__tiles" aria-hidden="true">
            {tasks.map((x, i) => <i key={x.id} className={`${x.set === 'test' ? 't-test' : 't-fresh'}${i === idx ? ' is-sel' : ''}`} />)}
          </span>
          <span className="wbd__sub">{nTest} test (SWE-rebench) · {tasks.length - nTest} fresh (2026)</span>
          <span className="wbd__sel">Selected: <code>{shortId(t.id)}</code></span>
        </button>
        <button type="button" className="wbd__module wbd__module--dev" aria-pressed={focus.kind === 'source' && focus.group === 'dev'} onClick={() => go({ kind: 'source', group: 'dev' })}>
          <span className="wbd__k">Dev · kept apart</span>
          <span className="wbd__sub">40 tasks · tuning only, never in the {summary.summary.runs} runs</span>
        </button>
      </div>

      <div className="wbd__flow">
        <div className="wbd__head" aria-hidden="true">
          <span>B · Condition and its setup</span><span>C · Workspaces</span><span className="wbd__head-wall">D</span><span>E · Graded</span><span>F · Score</span>
        </div>
        {arms.map((a, i) => {
          const c = CONDITIONS[a.id];
          const score = t.solved[a.id] / repeats;
          return (
            <div key={a.id} className={`wbd__row${laneOn(i) ? ' is-on' : ''}`}>
              <button type="button" className="wbd__lane" aria-pressed={focus.kind === 'lane' && focus.arm === a.id} onClick={() => go({ kind: 'lane', arm: a.id })}>
                <b style={condStyle(a.id)}>{i + 1}</b>
                <span className="wbd__lane-name">{a.label}</span>
                <span className="wbd__chips">
                  {c.hasTips && <i className={a.id === 'handwritten' ? 'c-generic' : 'c-tips'}>AGENTS.md</i>}
                  {c.hasHooks && <i className="c-hooks">hooks</i>}
                  {!c.hasTips && !c.hasHooks && <i className="c-none">nothing added</i>}
                </span>
              </button>
              <span className="wbd__ws">
                {Array.from({ length: repeats }, (_, q) => (
                  <button key={q} type="button" className="wbd__run" aria-label={`${a.label}, repeat ${q + 1}`}
                    aria-pressed={focus.kind === 'run' && focus.arm === a.id && focus.rep === q} onClick={() => go({ kind: 'run', arm: a.id, rep: q })}>
                    R{q + 1}
                  </button>
                ))}
              </span>
              <span className="wbd__slot" aria-hidden="true"><i /></span>
              <span className="wbd__lamps">
                {Array.from({ length: repeats }, (_, q) => {
                  const ok = runs ? runs[i]?.[q] : q < t.solved[a.id];
                  return <i key={q} className={ok ? 'l-ok' : 'l-fail'} title={ok ? 'Solved' : 'Failed'} />;
                })}
              </span>
              <button type="button" className="wbd__score" aria-label={`${a.label}: score ${score.toFixed(1)}`} onClick={() => go({ kind: 'analysis' })}>
                <span className="wbd__bar"><i className={score === 1 ? 'b-ok' : score === 0 ? 'b-fail' : 'b-half'} style={{ width: `${Math.max(4, score * 100)}%` }} /><em style={{ left: `${none * 100}%` }} /></span>
              </button>
            </div>
          );
        })}
        <div className="wbd__wall" aria-hidden="true" />
        <div className="wbd__sides">
          <button type="button" className="wbd__side wbd__side--agent" aria-pressed={focus.kind === 'agent'} onClick={() => go({ kind: 'agent' })}>
            ← What the agent receives
          </button>
          <button type="button" className="wbd__side wbd__side--eval" aria-pressed={focus.kind === 'evaluator'} onClick={() => go({ kind: 'evaluator' })}>
            What the evaluator uses →
          </button>
        </div>
        <button type="button" className="wbd__ws-note" onClick={() => go({ kind: 'workspace' })}>
          Each workspace: snapshot with no git history · repo's own agent files removed · only this condition's setup
        </button>
        <p className="wbd__veil wbd__veil--eval" aria-hidden="true">Hidden from the agent: the real fix's tests</p>
        <p className="wbd__veil wbd__veil--agent" aria-hidden="true">Only the patch crosses to grading</p>
      </div>
    </div>
  );
}
