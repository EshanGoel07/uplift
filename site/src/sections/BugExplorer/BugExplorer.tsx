import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ArmId, Summary, Task, TaskMeta } from '../../data/types';
import { loadTask } from '../../data/load';
import { GROUP_LABEL, GROUP_ORDER, githubUrl, groupOf, shortId, sortForMatrix } from '../../data/classify';
import { usd } from '../../data/format';
import { FEATURED_TASK } from '../../data/reportFigures';
import { CONDITIONS } from '../../data/method';
import { useInView } from '../../hooks/useInView';
import { useMedia, WIDE } from '../../hooks/useMedia';
import { RunBoard, type RunPick } from '../../components/explorer/RunBoard';
import { RunPanel } from '../../components/explorer/RunPanel';
import { Issue } from '../../components/explorer/Issue';
import { Bridge } from '../../components/navigation/Bridge';

interface Props {
  summary: Summary | null;
  taskId: string;
  onSelectTask: (id: string) => void;
}

/** Explore any of the 77 bugs: pick one, see its twelve runs, open or compare any two. */
export function BugExplorer({ summary, taskId, onSelectTask }: Props) {
  const root = useRef<HTMLElement>(null);
  // Task files load only when the explorer approaches (or a task is opened from elsewhere).
  const near = useInView(root, '600px 0px');
  const wide = useMedia(WIDE);
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

  const meta = summary?.tasks.find((t) => t.id === taskId) ?? null;

  return (
    <section id="explorer-all" ref={root} className="pub explorer" aria-labelledby="explorer-title">
      <div className="pub-container">
        <header className="pub-head">
          <p className="pub-eyebrow">Explore any bug</p>
          <h2 id="explorer-title" className="pub-title">Every bug, every run.</h2>
          <p className="pub-lead">
            Pick any of the {summary?.tasks.length ?? 77} bugs to see the issue the agent saw and all twelve runs: each condition's two
            repeats, whether the real tests passed, the hook messages it received and the patch it wrote.
          </p>
        </header>

        <div className="ex">
          {summary && (
            wide
              ? <TaskPicker tasks={summary.tasks} arms={summary.arms.map((a) => a.id)} value={taskId} onChange={onSelectTask} />
              : (
                <details className="ex-picker-acc">
                  <summary>Choose a bug <span>({summary.tasks.length})</span></summary>
                  <TaskPicker tasks={summary.tasks} arms={summary.arms.map((a) => a.id)} value={taskId} onChange={onSelectTask} />
                </details>
              )
          )}
          <div className="ex-main">
            {error && <p className="load-error" role="alert">Could not load this bug ({error}).</p>}
            {!task || task.id !== taskId
              ? <div className="pub-skeleton pub-skeleton--explorer" role="status" aria-busy="true" aria-label="Loading bug" />
              : <TaskView key={task.id} task={task} summary={summary} groupLabel={meta ? GROUP_LABEL[groupOf(meta.solved)] : ''} accordion={!wide} />}
          </div>
        </div>
        <Bridge to="details">How was this built, and how reliable is it? →</Bridge>
      </div>
    </section>
  );
}

/** Searchable list of all bugs, grouped by outcome band, with each bug's six-condition pattern. */
function TaskPicker({ tasks, arms, value, onChange }: { tasks: TaskMeta[]; arms: ArmId[]; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const sorted = useMemo(() => sortForMatrix(tasks), [tasks]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? sorted.filter((t) => t.title.toLowerCase().includes(s) || t.id.toLowerCase().includes(s)) : sorted;
  }, [sorted, q]);
  const idx = sorted.findIndex((t) => t.id === value);
  const step = (d: number) => onChange(sorted[(idx + d + sorted.length) % sorted.length].id);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('.tp-item') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    next?.focus();
    e.preventDefault();
  };

  return (
    <div className="tp">
      <div className="tp__top">
        <label className="tp__search">
          <span className="visually-hidden">Search bugs by title or id</span>
          <input type="search" placeholder={`Search ${tasks.length} bugs by title or id`} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="tp__nav">
          <button type="button" aria-label="Previous bug" onClick={() => step(-1)}>←</button>
          <button type="button" aria-label="Next bug" onClick={() => step(1)}>→</button>
        </div>
      </div>
      <p className="tp__count" aria-live="polite">{shown.length} of {tasks.length} bugs</p>
      <div className="tp__list" ref={list} onKeyDown={onKey} role="listbox" aria-label="Bugs">
        {GROUP_ORDER.map((g) => {
          const items = shown.filter((t) => groupOf(t.solved) === g);
          if (!items.length) return null;
          return (
            <div key={g} role="group" aria-label={GROUP_LABEL[g]} className="tp__group">
              <p className={`tp__band tp__band--${g}`}>{GROUP_LABEL[g]} · {items.length}</p>
              {items.map((t) => {
                const total = arms.reduce((a, id) => a + t.solved[id], 0);
                return (
                  <button key={t.id} type="button" role="option" aria-selected={t.id === value} className={`tp-item${t.id === value ? ' is-sel' : ''}`}
                    onClick={() => onChange(t.id)}>
                    <span className="tp-item__top">
                      <span className={`tag tag--${t.set}`}>{t.set}</span>
                      <span className="tp-item__id">{shortId(t.id)}</span>
                      <span className="tp-item__cells" aria-label={`${total} of 12 runs solved`}>
                        {arms.map((id) => <i key={id} className={`mc mc--${t.solved[id]}`} />)}
                      </span>
                    </span>
                    <span className="tp-item__title">{t.title}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {!shown.length && <p className="tp__empty">No bug matches “{q}”.</p>}
      </div>
    </div>
  );
}

function TaskView({ task, summary, groupLabel, accordion }: { task: Task; summary: Summary | null; groupLabel: string; accordion: boolean }) {
  const arms = summary?.arms ?? [];
  const label = (id: ArmId) => arms.find((a) => a.id === id)?.label ?? id;
  // The baseline's first repeat opens first: neutral, not the answer.
  const [pick, setPick] = useState<RunPick>({ arm: 'none', run: 0 });
  const [compare, setCompare] = useState(false);
  const [pickB, setPickB] = useState<RunPick>({ arm: 'tuned', run: 0 });
  const url = githubUrl(task);
  const cost = Object.values(task.results).reduce((a, r) => a + r.runs.reduce((b, x) => b + x.cost_usd, 0), 0);
  const solved = arms.reduce((a, x) => a + task.results[x.id].runs.filter((r) => r.resolved).length, 0);

  const panel = (p: RunPick) => (
    <RunPanel run={task.results[p.arm].runs[p.run]} armLabel={label(p.arm)} runIndex={p.run} taskId={shortId(task.id)} hasHooks={CONDITIONS[p.arm].hasHooks} collapsible={accordion} />
  );

  return (
    <div className="ex-task">
      <header className="ex-head">
        <div className="ex-head__ids">
          <span className={`tag tag--${task.set}`}>{task.set}</span>
          <span className="ex-head__id">{task.id}</span>
          {groupLabel && <span className="ex-chip">{groupLabel}</span>}
          <span className="ex-chip">{solved} of 12 runs solved · {usd(cost, 3)}</span>
        </div>
        <h3 className="ex-head__title">{task.title}</h3>
        {url
          ? <a className="ex-head__link" href={url} target="_blank" rel="noopener noreferrer">Upstream pull request #{url.split('/').pop()} ↗</a>
          : <p className="ex-head__nolink">Fresh 2026 bug mined from sqlglot's history; no upstream link is recorded for it.</p>}
      </header>

      <Issue text={task.issue} />

      <div className="ex-boardbar">
        <p className="ex-boardbar__hint">{compare ? 'Run A stays fixed; select a run to set B.' : 'Select a run to inspect it.'}</p>
        <button type="button" className="ex-more" aria-pressed={compare} onClick={() => setCompare(!compare)}>
          {compare ? 'Exit compare' : 'Compare two runs'}
        </button>
      </div>
      <RunBoard task={task} arms={arms} a={pick} b={compare ? pickB : undefined} accordion={accordion}
        onSelect={(p) => (compare ? setPickB(p) : setPick(p))} />

      <div className={`ex-detail${compare ? ' is-compare' : ''}`}>
        {compare
          ? <><div className="ex-col"><p className="ex-col__tag">A</p>{panel(pick)}</div><div className="ex-col"><p className="ex-col__tag">B</p>{panel(pickB)}</div></>
          : panel(pick)}
      </div>
    </div>
  );
}
