import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ArmId, Summary, Task } from '../../data/types';
import { loadTask } from '../../data/load';
import { GROUP_LABEL, groupOf, githubUrl, shortId, sortForMatrix } from '../../data/classify';
import { usd } from '../../data/format';
import { FEATURED_TASK } from '../../data/reportFigures';
import { useInView } from '../../hooks/useInView';
import { scheduleRefresh } from '../../hooks/useGsap';
import { SectionHead } from '../../components/interface/SectionHead';
import { RunPanel, StatusBadge } from '../../components/explorer/RunPanel';

interface Props {
  summary: Summary | null;
  taskId: string;
  onSelectTask: (id: string) => void;
}

interface Pick { arm: ArmId; run: number }

export function BugExplorer({ summary, taskId, onSelectTask }: Props) {
  const root = useRef<HTMLElement>(null);
  // The featured task is fetched only when the explorer approaches the viewport (or a task is opened).
  const near = useInView(root, '600px 0px');
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  useEffect(() => { if (taskId !== FEATURED_TASK) setRequested(true); }, [taskId]);
  useEffect(() => { if (near) setRequested(true); }, [near]);

  useEffect(() => {
    if (!requested) return;
    let live = true;
    setError(null);
    loadTask(taskId).then((t) => { if (live) setTask(t); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [taskId, requested]);

  useEffect(() => { if (task) scheduleRefresh(); }, [task]);

  const meta = summary?.tasks.find((t) => t.id === taskId) ?? null;
  const featured = taskId === FEATURED_TASK;

  return (
    <section id="explorer" ref={root} className="section explorer-section" aria-labelledby="explorer-title">
      <div className="container">
        <SectionHead index="03" eyebrow="Inside the experiment" id="explorer-title" title="Open any bug. Read every run."
          lead="The GitHub issue the agent saw, then all twelve runs: each setup's two repeats, whether the real tests passed, what it cost, what the hooks told the agent, and the patch it wrote." />

        <div className="ex">
          <div className="ex-top">
            {summary && (
              <label className="ex-picker">
                <span className="label">Bug</span>
                <select value={taskId} onChange={(e) => onSelectTask(e.target.value)}>
                  {(['always', 'mixed', 'never'] as const).map((g) => (
                    <optgroup key={g} label={GROUP_LABEL[g]}>
                      {sortForMatrix(summary.tasks).filter((t) => groupOf(t.solved) === g).map((t) => (
                        <option key={t.id} value={t.id}>{shortId(t.id)} · {t.title.slice(0, 70)}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
            {!featured && <button type="button" className="btn btn--small btn--ghost" onClick={() => onSelectTask(FEATURED_TASK)}>Back to the featured example</button>}
          </div>

          {featured && (
            <aside className="featured-note" aria-label="About the featured example">
              <p className="label label--ember">Featured example: what a run looks like</p>
              <p>No setup failed both runs; Tips + hooks solved both. In those two runs the hooks sent co-change warnings (and, in one, a ruff format reminder), and the agent still changed only <code>sqlglot/parser.py</code> (plus a test in one run). <strong>This shows what a run looks like. It does not show that hooks caused the fix:</strong> it is one bug and two runs, the agent did not act on the warning, and Hooks (generated) also received messages here and failed both of its runs.</p>
              <p className="featured-note__foot">Web exposure for this task could not be verified: the per-run web audit is not in the published data, so we can't rule out that a run looked up the fix.</p>
            </aside>
          )}

          {error && <p className="load-error" role="alert">Could not load this bug ({error}).</p>}
          {!task || task.id !== taskId
            ? <div className="skeleton skeleton--explorer" role="status" aria-busy="true" aria-label="Loading bug" />
            : <TaskView key={task.id} task={task} summary={summary} groupLabel={meta ? GROUP_LABEL[groupOf(meta.solved)] : ''} featured={featured} />}
        </div>
      </div>
    </section>
  );
}

function TaskView({ task, summary, groupLabel, featured }: { task: Task; summary: Summary | null; groupLabel: string; featured: boolean }) {
  const arms = summary?.arms ?? [];
  const label = (id: ArmId) => arms.find((a) => a.id === id)?.label ?? id;
  const [pick, setPick] = useState<Pick>({ arm: featured ? 'both' : 'none', run: 0 });
  const [compare, setCompare] = useState(false);
  const [pickB, setPickB] = useState<Pick>({ arm: featured ? 'none' : 'tuned', run: 0 });
  const url = githubUrl(task);
  const cost = Object.values(task.results).reduce((a, r) => a + r.runs.reduce((b, x) => b + x.cost_usd, 0), 0);

  const select = (p: Pick) => {
    if (compare) setPickB(p);
    else setPick(p);
  };

  return (
    <div className="ex-task">
      <header className="ex-head">
        <div className="ex-head__ids">
          <span className={`tag tag--${task.set}`}>{task.set}</span>
          <span className="mono ex-head__id">{task.id}</span>
          {groupLabel && <span className="chip">{groupLabel}</span>}
          <span className="chip mono">12 runs · {usd(cost, 3)}</span>
        </div>
        <h3 className="ex-head__title">{task.title}</h3>
        {url
          ? <a className="ex-head__link" href={url} target="_blank" rel="noopener noreferrer">Upstream pull request #{url.split('/').pop()} ↗</a>
          : <p className="ex-head__nolink">Fresh 2026 bug mined from sqlglot's history; no upstream link is recorded for it.</p>}
      </header>

      <div className="ex-body">
        <Issue text={task.issue} />

        <div className="ex-runs">
          <div className="ex-rail" role="group" aria-label="Setups and their two runs">
            <div className="ex-rail__head">
              <span className="label">Setup</span>
              <span className="label">Run 1</span>
              <span className="label">Run 2</span>
            </div>
            {arms.map((a) => (
              <div key={a.id} className={`ex-arm${pick.arm === a.id ? ' is-a' : ''}${compare && pickB.arm === a.id ? ' is-b' : ''}`}>
                <span className="ex-arm__label">{a.label}</span>
                {task.results[a.id].runs.map((r, i) => {
                  const isA = pick.arm === a.id && pick.run === i;
                  const isB = compare && pickB.arm === a.id && pickB.run === i;
                  return (
                    <button key={i} type="button" className={`run-pill${r.resolved ? ' is-ok' : ' is-fail'}${isA ? ' is-a' : ''}${isB ? ' is-b' : ''}`}
                            aria-pressed={isA || isB}
                            aria-label={`${a.label}, run ${i + 1}: ${r.resolved ? 'resolved' : 'failed'}${r.hooks.length ? `, ${r.hooks.length} hook message${r.hooks.length > 1 ? 's' : ''}` : ''}`}
                            onClick={() => select({ arm: a.id, run: i })}>
                      <span aria-hidden="true">{r.resolved ? '✓' : '✗'}</span>
                      {r.hooks.length > 0 && <span className="hook-dot" aria-hidden="true" />}
                      {isA && compare && <span className="run-pill__tag" aria-hidden="true">A</span>}
                      {isB && <span className="run-pill__tag" aria-hidden="true">B</span>}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="ex-rail__foot">
              <button type="button" className="btn btn--small" aria-pressed={compare} onClick={() => setCompare(!compare)}>
                {compare ? 'Exit compare' : 'Compare two runs'}
              </button>
              <span className="ex-rail__hint">{compare ? 'A stays fixed; click a run to set B.' : 'Click a run to inspect it.'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className={`ex-detail${compare ? ' is-compare' : ''}`}>
        {compare ? (
          <>
            <div className="ex-col"><p className="ex-col__tag label">A</p><RunPanel run={task.results[pick.arm].runs[pick.run]} armLabel={label(pick.arm)} runIndex={pick.run} /></div>
            <div className="ex-col"><p className="ex-col__tag label">B</p><RunPanel run={task.results[pickB.arm].runs[pickB.run]} armLabel={label(pickB.arm)} runIndex={pickB.run} /></div>
          </>
        ) : (
          <RunPanel run={task.results[pick.arm].runs[pick.run]} armLabel={label(pick.arm)} runIndex={pick.run} />
        )}
      </div>

      <p className="ex-summary">
        {arms.map((a) => (
          <span key={a.id} className="ex-summary__item">
            {a.label}: {task.results[a.id].runs.map((r, i) => <StatusBadgeMini key={i} ok={r.resolved} />)}
          </span>
        ))}
      </p>
    </div>
  );
}

const StatusBadgeMini = ({ ok }: { ok: boolean }) => (
  <span className={`mini ${ok ? 'mini--ok' : 'mini--fail'}`} role="img" aria-label={ok ? 'resolved' : 'failed'}>{ok ? '✓' : '✗'}</span>
);

// marked + DOMPurify load with the explorer, not with the first paint.
let mdModule: Promise<typeof import('../../utils/markdown')> | null = null;
const loadMarkdown = () => (mdModule ??= import('../../utils/markdown'));

function Issue({ text }: { text: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadMarkdown().then((m) => { if (live) setHtml(m.renderIssueMarkdown(text)); });
    return () => { live = false; };
  }, [text]);
  const body = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const el = body.current;
    if (el) setLong(el.scrollHeight > el.clientHeight + 4);
  }, [html]);
  return (
    <div className="ex-issue">
      <div className="ex-issue__bar"><span className="label">GitHub issue · what the agent saw</span></div>
      {html === null
        ? <pre className="md md--plain is-collapsed">{text}</pre>
        : <div ref={body} className={`md${open ? '' : ' is-collapsed'}${long && !open ? ' has-more' : ''}`}
               // Sanitised by DOMPurify in renderIssueMarkdown: no images, scripts, handlers or unsafe links.
               dangerouslySetInnerHTML={{ __html: html }} />}
      {(long || open) && (
        <button type="button" className="btn btn--small btn--ghost" aria-expanded={open} onClick={() => { setOpen(!open); scheduleRefresh(); }}>
          {open ? 'Collapse issue' : 'Show the full issue'}
        </button>
      )}
    </div>
  );
}

export { StatusBadge };
