import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ArmId, Group, Summary, TaskMeta, TaskSet } from '../../data/types';
import { GROUP_LABEL, GROUP_ORDER, groupCounts, groupOf, shortId, sortForMatrix } from '../../data/classify';
import { useInView } from '../../hooks/useInView';
import { Bridge } from '../../components/navigation/Bridge';
import { Icon } from '../../components/atlas/Icon';
import { condStyle } from '../../utils/condition';
import { atlas, openTask, useAtlas } from '../../state/atlasStore';
import { EmptyState } from '../../components/atlas/Primitives';

interface Props {
  summary: Summary | null;
  onOpenTask: (id: string) => void;
  selectedTask: string;
}

type SetFilter = 'all' | TaskSet;
type GroupFilter = 'all' | Group;
type HookFilter = 'all' | 'fired' | 'none';

const BAND_NOTE: Record<Group, string> = {
  always: 'every run of every condition solved them, so they cannot separate conditions',
  mixed: 'the only bugs that can separate conditions in this design',
  never: 'no run of any condition solved them',
};

export function BugMatrix({ summary, onOpenTask, selectedTask }: Props) {
  const root = useRef<HTMLElement>(null);
  // The 462-cell grid renders when the section approaches, keeping first paint light.
  const near = useInView(root, '1200px 0px');

  return (
    <section id="matrix" ref={root} className="pub runs" aria-labelledby="matrix-title">
      <div className="pub-container">
        <header className="pub-head">
          <p className="pub-eyebrow">Bug Atlas</p>
          <h2 id="matrix-title" className="pub-title">All 77 bugs under all six conditions.</h2>
          <p className="pub-lead">
            Each cell is one bug under one condition: how many of its two runs the repository's real tests resolved. Most bugs
            behave the same under every condition, which is why the study could only detect large effects.
          </p>
        </header>
        {summary && <Ceiling summary={summary} />}
        {summary && near
          ? <Matrix summary={summary} onOpenTask={onOpenTask} selectedTask={selectedTask} />
          : <div className="pub-skeleton pub-skeleton--matrix" role="status" aria-busy="true" aria-label="Loading the matrix" />}
      </div>
    </section>
  );
}

/** The ceiling effect as one bar: how many bugs can separate conditions at all. */
function Ceiling({ summary }: { summary: Summary }) {
  const c = groupCounts(summary.tasks);
  const n = summary.tasks.length;
  return (
    <figure className="ceiling" aria-labelledby="ceiling-cap">
      <div className="ceiling__bar" aria-hidden="true">
        {GROUP_ORDER.map((g) => (
          <span key={g} className={`ceiling__seg ceiling__seg--${g}`} style={{ flex: `${c[g]} 1 0` }}>
            <b>{c[g]}</b> <span className="ceiling__w">{GROUP_LABEL[g].toLowerCase()}</span>
          </span>
        ))}
      </div>
      <figcaption id="ceiling-cap" className="caption">
        <span className="caption__n">The ceiling effect.</span> {c.always} of {n} bugs were solved by every run of every condition
        and {c.never} by none, so only the <strong>{c.mixed} mixed bugs</strong> can show a difference between conditions. Repeats of
        the same condition also disagree, which is why every comparison is paired and uses both repeats.
      </figcaption>
    </figure>
  );
}

type AtlasView = 'matrix' | 'list' | 'lattice';
type SortKey = 'solved' | 'least' | 'cost' | 'id';
const param = (k: string): string | null => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(k));

/** Filter state lives in the URL too, so a filtered Atlas can be shared. Replaces, so Back is not flooded. */
function writeParams(p: Record<string, string>): void {
  const q = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(p)) { if (v) q.set(k, v); else q.delete(k); }
  const s = q.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${s ? `?${s}` : ''}${window.location.hash}`);
}

const cellText = (v: number) => (v === 2 ? '2/2' : v === 1 ? '1/2' : '0/2');

function Matrix({ summary, onOpenTask, selectedTask }: { summary: Summary } & Omit<Props, 'summary'>) {
  const [setF, setSetF] = useState<SetFilter>((param('set') as SetFilter) || 'all');
  const [groupF, setGroupF] = useState<GroupFilter>((param('group') as GroupFilter) || 'all');
  const [hookF, setHookF] = useState<HookFilter>((param('hooks') as HookFilter) || 'all');
  const [query, setQuery] = useState(param('q') ?? '');
  const [view, setView] = useState<AtlasView>((param('atlas') as AtlasView) || 'list');
  const [sort, setSort] = useState<SortKey>((param('sort') as SortKey) || 'solved');
  const [compact, setCompact] = useState(param('density') === 'compact');
  const condition = useAtlas((s) => s.condition);
  const [more, setMore] = useState(setF !== 'all' || hookF !== 'all' || sort !== 'solved' || compact || !!condition);
  useEffect(() => {
    writeParams({ set: setF === 'all' ? '' : setF, group: groupF === 'all' ? '' : groupF, hooks: hookF === 'all' ? '' : hookF, q: query, atlas: view === 'list' ? '' : view, sort: sort === 'solved' ? '' : sort, density: compact ? 'compact' : '' });
  }, [setF, groupF, hookF, query, view, sort, compact]);
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [tip, setTip] = useState<{ task: TaskMeta; arm: ArmId; x: number; y: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const arms = summary.arms;
  const counts = useMemo(() => groupCounts(summary.tasks), [summary.tasks]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const kept = sortForMatrix(summary.tasks).filter((t) =>
      (setF === 'all' || t.set === setF) &&
      (groupF === 'all' || groupOf(t.solved) === groupF) &&
      (hookF === 'all' || (hookF === 'fired' ? t.hooksFired : !t.hooksFired)) &&
      (!q || t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)));
    if (sort === 'least') kept.sort((a, b) => a.total - b.total);
    else if (sort === 'cost') kept.sort((a, b) => b.cost - a.cost);
    else if (sort === 'id') kept.sort((a, b) => a.id.localeCompare(b.id));
    return kept;
  }, [summary.tasks, setF, groupF, hookF, query, sort]);

  const bands = GROUP_ORDER.map((g) => ({ g, rows: rows.filter((t) => groupOf(t.solved) === g) })).filter((b) => b.rows.length);
  const flat = bands.flatMap((b) => b.rows);
  const cols = arms.length;
  const fr = Math.min(focus.r, Math.max(0, flat.length - 1));

  const moveFocus = (r: number, c: number) => {
    const rr = Math.max(0, Math.min(flat.length - 1, r));
    const cc = Math.max(0, Math.min(cols, c));
    setFocus({ r: rr, c: cc });
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-r="${rr}"][data-c="${cc}"]`)?.focus());
  };

  const onKey = (e: KeyboardEvent, r: number, c: number) => {
    const k = e.key;
    if (k === 'ArrowRight') moveFocus(r, c + 1);
    else if (k === 'ArrowLeft') moveFocus(r, c - 1);
    else if (k === 'ArrowDown') moveFocus(r + 1, c);
    else if (k === 'ArrowUp') moveFocus(r - 1, c);
    else if (k === 'Home') moveFocus(r, 0);
    else if (k === 'End') moveFocus(r, cols);
    else if (k === 'PageDown') moveFocus(r + 10, c);
    else if (k === 'PageUp') moveFocus(r - 10, c);
    else if (k === 'Enter' || k === ' ') onOpenTask(flat[r].id);
    else return;
    e.preventDefault();
  };

  const showTip = (el: HTMLElement, task: TaskMeta, arm: ArmId) => {
    const w = wrapRef.current!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setTip({ task, arm, x: r.left - w.left + r.width / 2, y: r.bottom - w.top + 6 });
  };

  let rowIndex = -1;
  return (
    <div className={`mx${compact ? ' is-compact' : ''}`}>
      <div className="mx-views">
        <div className="seg" role="group" aria-label="Atlas view">
          {([['matrix', 'Matrix'], ['list', 'Task list'], ['lattice', 'Lattice']] as const).map(([v, t]) => (
            <button key={v} type="button" className="seg__btn" aria-pressed={view === v} onClick={() => setView(v)}>{t}</button>
          ))}
        </div>
        <label className="mx-search">
          <span className="visually-hidden">Search bugs</span>
          <Icon name="search" size={14} />
          <input type="search" placeholder="Search title or id" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="mx-toolbar" role="group" aria-label="Matrix filters">
        <Seg label="Outcome" value={groupF} onChange={setGroupF}
             options={[['all', 'All'], ['always', `Always solved (${counts.always})`], ['mixed', `Mixed (${counts.mixed})`], ['never', `Never solved (${counts.never})`]]} />
      </div>
      <details className="mx-more" open={more} onToggle={(e) => setMore(e.currentTarget.open)}>
        <summary>More filters</summary>
        <div className="mx-toolbar">
          <Seg label="Set" value={setF} onChange={setSetF} options={[['all', 'All'], ['test', 'Test'], ['fresh', 'Fresh']]} />
          <Seg label="Hooks" value={hookF} onChange={setHookF} options={[['all', 'All'], ['fired', 'Hooks fired'], ['none', 'No hooks']]} />
          <label className="cc__against">Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="solved">Most solved</option>
              <option value="least">Least solved</option>
              <option value="cost">Highest cost</option>
              <option value="id">Task id</option>
            </select>
          </label>
          <label className="cc__against">Condition
            <select value={condition ?? ''} onChange={(e) => atlas.set({ condition: (e.target.value || null) as ArmId | null })}>
              <option value="">All six</option>
              {arms.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>
          <div className="seg" role="group" aria-label="Density">
            <button type="button" className="seg__btn" aria-pressed={!compact} onClick={() => setCompact(false)}>Comfortable</button>
            <button type="button" className="seg__btn" aria-pressed={compact} onClick={() => setCompact(true)}>Compact</button>
          </div>
        </div>
      </details>

      <div className="mx-meta">
        <p className="mx-count" aria-live="polite">Showing {flat.length} of {summary.tasks.length} bugs</p>
        {view === 'matrix' && (
          <ul className="mx-legend" aria-label="Legend">
            <li><span className="mx-swatch" data-v="2">2/2</span> both runs solved</li>
            <li><span className="mx-swatch" data-v="1">1/2</span> one of two</li>
            <li><span className="mx-swatch" data-v="0">0/2</span> neither</li>
            <li><span className="tag tag--test">test</span> <span className="tag tag--fresh">fresh</span> task set</li>
            <li><span className="hook-dot" aria-hidden="true" /> a hook message reached the agent</li>
          </ul>
        )}
      </div>

      {view === 'list' && (
        <ul className="tasklist">
          {flat.map((t) => (
            <li key={t.id} className={t.id === selectedTask ? 'is-sel' : undefined}>
              <button type="button" onClick={() => openTask(t.id)}>
                <span className={`tag tag--${t.set}`}>{t.set}</span>
                <span className="tasklist__t">{t.title}</span>
                <span className="tasklist__id">{shortId(t.id)}</span>
                <span className={`chip-g g-${groupOf(t.solved)}`}>{GROUP_LABEL[groupOf(t.solved)]}</span>
                <span className="tasklist__n">{t.total}/12</span>
              </button>
            </li>
          ))}
          {flat.length === 0 && <EmptyState title="No bugs match these filters">Clear a filter to see more of the 77 bugs.</EmptyState>}
        </ul>
      )}

      {view === 'lattice' && (
        <div className="minilat" role="group" aria-label="Every run of each matching bug. Columns are bugs; rows are conditions and repeats.">
          {flat.map((t) => (
            <button key={t.id} type="button" className={`minilat__bug${t.id === selectedTask ? ' is-sel' : ''}`} onClick={() => openTask(t.id)} aria-label={`${shortId(t.id)}: ${t.total} of 12 runs solved`} title={`${shortId(t.id)}: ${t.title}`}>
              {arms.flatMap((a) => [0, 1].map((k) => <i key={`${a.id}${k}`} className={`${k < t.solved[a.id] ? 'ok' : 'no'}${condition && condition !== a.id ? ' dim' : ''}`} />))}
            </button>
          ))}
          {flat.length === 0 && <EmptyState title="No bugs match these filters" />}
        </div>
      )}
      {view === 'lattice' && <p className="caption">Each column is one bug and each cell one run, in condition order. Within a pair the solved run is drawn first: the summary records how many of the two solved, so order within a pair is not meaningful here. The run record shows each repeat exactly.</p>}

      {view === 'matrix' && <p className="mx-swipe" aria-hidden="true">Swipe sideways to see all six conditions →</p>}
      {view === 'matrix' && <div className="mx-scroll" ref={wrapRef} onScroll={() => setTip(null)}>
        <div ref={gridRef} className="mx-grid" role="grid" aria-label="Bugs by condition: resolved runs out of 2" aria-rowcount={flat.length + 1}
             style={{ ['--cols' as string]: cols }} onMouseLeave={() => setTip(null)}>
          <div className="mx-row mx-row--head" role="row">
            <div className="mx-th mx-th--task" role="columnheader">Bug</div>
            {arms.map((a, i) => <div key={a.id} className="mx-th" role="columnheader"><span className="mx-th__n" style={condStyle(a.id)}>{i + 1}</span>{a.label}</div>)}
          </div>

          {bands.map((b) => (
            <div key={b.g} role="rowgroup" className={`mx-band mx-band--${b.g}`}>
              <div className="mx-band__head" role="row">
                <div role="columnheader" aria-colspan={cols + 1} className="mx-band__title">
                  <span className="mono">{b.rows.length}</span> {GROUP_LABEL[b.g]}
                  <span className="mx-band__note">{BAND_NOTE[b.g]}</span>
                </div>
              </div>
              {b.rows.map((t) => {
                rowIndex++;
                const r = rowIndex;
                const isSel = t.id === selectedTask;
                return (
                  <div key={t.id} role="row" className={`mx-row${isSel ? ' is-selected' : ''}`} aria-selected={isSel}>
                    <div role="rowheader" className="mx-task" data-r={r} data-c={0} tabIndex={fr === r && focus.c === 0 ? 0 : -1}
                         onKeyDown={(e) => onKey(e, r, 0)} onFocus={() => setFocus({ r, c: 0 })} onClick={() => onOpenTask(t.id)}
                         title={`Open ${t.title} in the explorer`}>
                      <span className={`tag tag--${t.set}`}>{t.set}</span>
                      <span className="mx-task__title">{t.title}</span>
                      <span className="mx-task__id">{shortId(t.id)}</span>
                      {t.hooksFired && <span className="hook-dot" title="A hook message reached the agent in at least one run" />}
                    </div>
                    {arms.map((a, i) => {
                      const v = t.solved[a.id];
                      const c = i + 1;
                      return (
                        <div key={a.id} role="gridcell" className={`mx-cell${condition && condition !== a.id ? ' is-dim' : ''}`} data-v={v} data-r={r} data-c={c}
                             tabIndex={fr === r && focus.c === c ? 0 : -1}
                             aria-label={`${t.title}, ${a.label}: ${v} of 2 runs resolved`}
                             onKeyDown={(e) => onKey(e, r, c)}
                             onFocus={(e) => { setFocus({ r, c }); showTip(e.currentTarget, t, a.id); }}
                             onBlur={() => setTip(null)}
                             onMouseEnter={(e) => showTip(e.currentTarget, t, a.id)}
                             onClick={() => onOpenTask(t.id)}>
                          <span aria-hidden="true">{cellText(v)}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && <p className="mx-empty">No bugs match these filters.</p>}
        </div>
        {tip && (
          <div className="mx-tooltip" style={{ left: tip.x, top: tip.y }} role="status">
            <p className="mx-tooltip__title">{tip.task.title}</p>
            <p className="mx-tooltip__sub">{shortId(tip.task.id)} · {tip.task.set} · {GROUP_LABEL[groupOf(tip.task.solved)]}</p>
            <p><strong>{arms.find((a) => a.id === tip.arm)!.label}:</strong> {tip.task.solved[tip.arm]} of 2 runs resolved</p>
            <p className="mx-tooltip__note">Click or press Enter to open in the explorer</p>
          </div>
        )}
      </div>}
      {view === 'matrix' && (
        <p className="caption mx-caption">
          <span className="caption__n">Figure 6.</span> Resolved runs out of 2 for each bug (rows) under each condition (columns), grouped by
          what happened across all twelve runs. Only the {counts.mixed} mixed bugs can tell conditions apart. Select any row or cell to open
          that bug's twelve runs below.
        </p>
      )}
      <Bridge to="explorer-all">Open the run explorer ↓</Bridge>
    </div>
  );
}

function Seg<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      <span className="seg__label" aria-hidden="true">{label}</span>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} className="seg__btn" onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}
