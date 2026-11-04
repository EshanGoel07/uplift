import { useEffect, useState, type ReactNode } from 'react';
import type { ArmId, Summary, Task, TaskMeta } from '../../data/types';
import { loadTask } from '../../data/load';
import { GROUP_LABEL, githubUrl, groupOf, shortId } from '../../data/classify';
import { ci, pts, usd } from '../../data/format';
import {
  AGENT_PROMPT, AGENT_SEES, ANALYSIS_STEPS, CONDITIONS, EVALUATOR_SEES, GRADING_STEPS, HIDDEN_FROM_AGENT,
  NETWORK_NOTE, RESOLVED_RULE, STRIPPED_AGENT_FILES, TASK_SOURCES, WORKSPACE_STEPS,
} from '../../data/method';
import { wb, useWb, type Focus } from '../../state/workbenchStore';
import { jumpTo } from '../../components/navigation/Nav';

interface Props { summary: Summary; tasks: TaskMeta[]; onOpenTask: (id: string) => void }

const go = (focus: Focus) => wb.set({ focus });

function Runs({ runs }: { runs: boolean[] | undefined }) {
  if (!runs) return <span className="wb-runs wb-runs--loading">loading</span>;
  return (
    <span className="wb-runs">
      {runs.map((r, i) => <span key={i} className={r ? 'r-ok' : 'r-fail'}>{r ? 'Solved' : 'Failed'}</span>)}
    </span>
  );
}

/** The workbench's explanation panel: one place that both the 3D model and the 2D diagram drive. */
export function Inspector({ summary, tasks, onOpenTask }: Props) {
  const focus = useWb((s) => s.focus);
  const idx = useWb((s) => s.task);
  const runs = useWb((s) => s.runs);
  const t = tasks[idx];
  const arms = summary.arms;
  const armIdx = (id: ArmId) => arms.findIndex((a) => a.id === id);
  const label = (id: ArmId) => arms[armIdx(id)]?.label ?? id;
  const nTest = tasks.filter((x) => x.set === 'test').length;
  const repeats = Math.round(arms[0].attempts / tasks.length);

  const [task, setTask] = useState<Task | null>(null);
  useEffect(() => {
    let live = true;
    setTask(null);
    if (focus.kind === 'run') loadTask(t.id).then((x) => { if (live) setTask(x); }).catch(() => {});
    return () => { live = false; };
  }, [t.id, focus.kind]);

  let kicker = '', title = '', body: ReactNode = null;

  switch (focus.kind) {
    case 'overview':
      kicker = 'Overview';
      title = 'One bug, six conditions, two repeats each.';
      body = (
        <>
          <p>Follow the selected bug from left to right. Choose any part to read what it does.</p>
          <ol className="wb-steps">
            {([
              ['A', 'Task source', `${tasks.length} main bugs; the 40 dev tasks are kept apart.`, { kind: 'source', group: 'main' }],
              ['B', 'Six conditions', 'The same bug goes down every lane, twice.', { kind: 'lane', arm: 'none' }],
              ['C', 'Isolated workspaces', 'A snapshot with no history and only the assigned setup.', { kind: 'workspace' }],
              ['D', 'Information barrier', 'Only the patch crosses; the tests never do.', { kind: 'agent' }],
              ['E', 'Evaluator', "The repo's real tests decide each run.", { kind: 'evaluator' }],
              ['F', 'Paired analysis', 'Each condition is compared with No setup on the same bug.', { kind: 'analysis' }],
            ] as [string, string, string, Focus][]).map(([k, n, d, f]) => (
              <li key={k}><button type="button" onClick={() => go(f)}><b>{k}</b><span><strong>{n}</strong>{d}</span></button></li>
            ))}
          </ol>
        </>
      );
      break;

    case 'source':
      if (focus.group === 'dev') {
        kicker = 'A · Task source';
        title = `${TASK_SOURCES.dev.count} dev tasks, kept out of the main experiment`;
        body = (
          <>
            <p>{TASK_SOURCES.dev.detail}</p>
            <dl className="wb-kv">
              <div><dt>Used for</dt><dd>Tuning the {label('tuned')} condition once, and dev-only ablations</dd></div>
              <div><dt>In the {summary.summary.runs} runs</dt><dd>No</dd></div>
            </dl>
          </>
        );
      } else {
        kicker = 'A · Task source';
        title = `${tasks.length} bugs: ${nTest} test and ${tasks.length - nTest} fresh`;
        const url = githubUrl(t);
        body = (
          <>
            <dl className="wb-kv">
              <div><dt>{TASK_SOURCES.test.name} · {nTest}</dt><dd>{TASK_SOURCES.test.detail}</dd></div>
              <div><dt>{TASK_SOURCES.fresh.name} · {tasks.length - nTest}</dt><dd>{TASK_SOURCES.fresh.detail}</dd></div>
            </dl>
            <div className="wb-card">
              <p className="wb-card__k">Selected bug</p>
              <p className="wb-card__id">{shortId(t.id)}</p>
              <p className="wb-card__title">{t.title}</p>
              <p className="wb-card__meta">
                {t.set === 'test' ? TASK_SOURCES.test.origin : TASK_SOURCES.fresh.origin} · {GROUP_LABEL[groupOf(t.solved)]}
                {url && <> · <a href={url} target="_blank" rel="noopener noreferrer">upstream PR ↗</a></>}
              </p>
            </div>
          </>
        );
      }
      break;

    case 'lane': {
      const c = CONDITIONS[focus.arm];
      const a = arms[armIdx(focus.arm)];
      kicker = `B · Condition ${armIdx(focus.arm) + 1} of ${arms.length}`;
      title = a.label;
      body = (
        <>
          <p className="wb-lead">{a.description}</p>
          <dl className="wb-kv">
            <div><dt>Receives</dt><dd><ul>{c.receives.map((x) => <li key={x}>{x}</li>)}</ul></dd></div>
            <div><dt>Does not receive</dt><dd><ul>{c.notReceives.map((x) => <li key={x}>{x}</li>)}</ul></dd></div>
            <div><dt>Files installed</dt><dd>{c.files.length ? <ul className="wb-files">{c.files.map((x) => <li key={x}><code>{x}</code></li>)}</ul> : 'None'}</dd></div>
            <div><dt>Why it exists</dt><dd>{c.why}</dd></div>
            <div><dt>This bug, {repeats} repeats</dt><dd><Runs runs={runs?.[armIdx(focus.arm)]} /></dd></div>
          </dl>
          <div className="wb-lanes">
            {arms.map((x, i) => (
              <button key={x.id} type="button" aria-pressed={x.id === focus.arm} onClick={() => go({ kind: 'lane', arm: x.id })}>{i + 1}</button>
            ))}
          </div>
        </>
      );
      break;
    }

    case 'run': {
      const r = task?.results[focus.arm].runs[focus.rep];
      const hooks = r?.hooks.length ?? 0;
      kicker = 'C → E · One run';
      title = `${label(focus.arm)}, repeat ${focus.rep + 1}`;
      body = (
        <>
          <p>Bug <code>{shortId(t.id)}</code>, one of the {arms.length * repeats} runs it received.</p>
          {!r ? <p className="wb-muted">Loading this run…</p> : (
            <dl className="wb-kv">
              <div><dt>Result</dt><dd><span className={r.resolved ? 'r-ok' : 'r-fail'}>{r.resolved ? 'Resolved by the real tests' : 'Not resolved'}</span></dd></div>
              <div><dt>Patch</dt><dd>{r.diff ? `${r.diff.split('\n').length} diff lines` : 'Empty diff'}</dd></div>
              <div><dt>Hook messages</dt><dd>{CONDITIONS[focus.arm].hasHooks ? (hooks ? `${hooks} delivered` : 'None fired') : 'No hooks in this condition'}</dd></div>
              <div><dt>Cost</dt><dd>{usd(r.cost_usd)}</dd></div>
            </dl>
          )}
          <button type="button" className="wb-btn" onClick={() => onOpenTask(t.id)}>Open this bug's 12 runs in the explorer</button>
        </>
      );
      break;
    }

    case 'workspace':
      kicker = 'C · Isolated workspace';
      title = 'Every run starts from the same clean snapshot';
      body = (
        <>
          <ol className="wb-list">{WORKSPACE_STEPS.map((s) => <li key={s.title}><strong>{s.title}.</strong> {s.detail}</li>)}</ol>
          <p className="wb-muted">Removed before installing the setup: {STRIPPED_AGENT_FILES.map((f, i) => <span key={f}>{i ? ', ' : ''}<code>{f}</code></span>)}.</p>
        </>
      );
      break;

    case 'agent':
      kicker = 'D · Agent side';
      title = 'What the agent receives';
      body = (
        <>
          <dl className="wb-kv">{AGENT_SEES.map((x) => <div key={x.k}><dt>{x.k}</dt><dd>{x.v}</dd></div>)}</dl>
          <p className="wb-card__k">The task prompt, the same in every condition</p>
          <pre className="wb-prompt">{AGENT_PROMPT.replace('{problem}', '…the GitHub issue text…')}</pre>
          <p className="wb-card__k">Never given to the agent</p>
          <ul className="wb-hidden">{HIDDEN_FROM_AGENT.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="wb-muted">{NETWORK_NOTE}</p>
        </>
      );
      break;

    case 'evaluator':
      kicker = 'D · Evaluator side';
      title = 'What the experiment uses to grade';
      body = (
        <>
          <dl className="wb-kv">{EVALUATOR_SEES.map((x) => <div key={x.k}><dt>{x.k}</dt><dd>{x.v}</dd></div>)}</dl>
          <ol className="wb-list">{GRADING_STEPS.map((s) => <li key={s.title}><strong>{s.title}.</strong> {s.detail}</li>)}</ol>
          <p className="wb-rule">{RESOLVED_RULE}</p>
        </>
      );
      break;

    case 'analysis': {
      const none = t.solved.none / repeats;
      kicker = 'F · Paired analysis';
      title = 'Each condition against No setup, on the same bug';
      body = (
        <>
          <table className="wb-table">
            <caption>Bug <code>{shortId(t.id)}</code>: score = share of its {repeats} runs solved</caption>
            <thead><tr><th scope="col">Condition</th><th scope="col">Runs</th><th scope="col" className="num">Score</th><th scope="col" className="num">vs No setup</th></tr></thead>
            <tbody>
              {arms.map((a, i) => {
                const sc = t.solved[a.id] / repeats;
                return (
                  <tr key={a.id}>
                    <th scope="row">{a.label}</th>
                    <td><Runs runs={runs?.[i]} /></td>
                    <td className="num">{sc.toFixed(1)}</td>
                    <td className="num">{a.id === 'none' ? 'baseline' : `${sc - none >= 0 ? '+' : '−'}${Math.abs(sc - none).toFixed(1)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ol className="wb-list">{ANALYSIS_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
          <p className="wb-card__k">Across all {tasks.length} bugs</p>
          <ul className="wb-overall">
            {arms.filter((a) => a.id !== 'none').map((a) => (
              <li key={a.id}><span>{a.label}</span><span>{pts(a.diff_vs_none)} pts · {ci(a.ci_low, a.ci_high)}</span></li>
            ))}
          </ul>
          <p className="wb-muted">Every interval crosses zero. <a href="#results" onClick={(e) => { e.preventDefault(); jumpTo('results'); }}>See the findings</a>.</p>
        </>
      );
      break;
    }
  }

  return (
    <aside className="wb-inspector" aria-live="polite" aria-labelledby="wb-inspector-title">
      <div className="wb-inspector__head">
        <p className="wb-inspector__k">{kicker}</p>
        {focus.kind !== 'overview' && (
          <button type="button" className="wb-inspector__back" onClick={() => wb.set({ focus: { kind: 'overview' } })}>Overview</button>
        )}
      </div>
      <h3 id="wb-inspector-title" className="wb-inspector__title">{title}</h3>
      <div className="wb-inspector__body">{body}</div>
    </aside>
  );
}
