import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArmId, Summary, Task } from '../../data/types';
import { loadTask } from '../../data/load';
import { shortId } from '../../data/classify';
import { APPROACH_INFO, FEATURED_APPROACHES, FEATURED_TASK, SHORTCUT_LINE, type Approach } from '../../data/reportFigures';
import { CONDITIONS } from '../../data/method';
import { DOC_LINKS } from '../../data/links';
import { useInView } from '../../hooks/useInView';
import { useMedia, WIDE } from '../../hooks/useMedia';
import { Bridge } from '../../components/navigation/Bridge';
import { RunBoard, type RunPick } from '../../components/explorer/RunBoard';
import { HookMessages, RunPanel, StatusBadge } from '../../components/explorer/RunPanel';
import { DiffViewer } from '../../components/explorer/DiffViewer';
import { Issue } from '../../components/explorer/Issue';
import { EvidenceBadge } from '../../components/atlas/Evidence';
import { ToolButton } from '../../components/atlas/Primitives';

/** The query from the issue, and the alias use the fix must keep working (README worked example). */
const ISSUE_QUERY = 'SELECT 1 WINDOW a AS (PARTITION BY fake_column);';
const ALIAS_QUERY = 'SELECT col window FROM t';
/** The co-change warning text, as delivered by the hooks (matched in the task data). */
const COCHANGE = 'co-change: you edited sqlglot/parser.py but not sqlglot/generator.py';

/** Default run shown for each approach: a shortcut and a look-ahead from conditions without hooks. */
/** What can be followed from the published evidence. It is a reading of the outcome, not a replay: no run trace is published. */
const TRACE = [
  ['Original issue', 'A WINDOW clause raises a ParseError when read as SQLite.'],
  ['Syntax ambiguity', 'WINDOW is also a valid column alias, so "1 WINDOW" reads as an alias.'],
  ['Implementation', 'Twelve patches took three approaches: shortcut, look-ahead and one other.'],
  ['Compatibility check', 'The repository\'s tests require WINDOW to keep working as an alias.'],
  ['Graded outcome', 'All 4 look-ahead runs solved it. All 7 shortcut runs and the other run failed.'],
] as const;

const DEFAULT_RUN: Record<Approach, RunPick> = {
  shortcut: { arm: 'none', run: 0 },
  lookahead: { arm: 'handwritten', run: 0 },
  other: { arm: 'prose', run: 1 },
};

export function WorkedExample({ summary }: { summary: Summary | null }) {
  const root = useRef<HTMLElement>(null);
  const near = useInView(root, '600px 0px');
  const wide = useMedia(WIDE);
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<RunPick | null>(null);
  const [shown, setShown] = useState<Record<Approach, RunPick>>(DEFAULT_RUN);
  const [only, setOnly] = useState<Approach | 'all'>('all');
  const [left, setLeft] = useState<RunPick>(DEFAULT_RUN.shortcut);
  const [right, setRight] = useState<RunPick>(DEFAULT_RUN.lookahead);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    if (!reading) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setReading(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [reading]);

  useEffect(() => {
    if (!near) return;
    let live = true;
    loadTask(FEATURED_TASK).then((t) => { if (live) setTask(t); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [near]);

  const arms = summary?.arms ?? [];
  const label = (id: ArmId) => arms.find((a) => a.id === id)?.label ?? id;

  // Everything below is computed from the task file: runs per approach, outcomes, hook recipients.
  const byApproach = useMemo(() => {
    const out: Record<Approach, { pick: RunPick; resolved: boolean }[]> = { shortcut: [], lookahead: [], other: [] };
    if (!task) return out;
    arms.forEach((a) => task.results[a.id].runs.forEach((r, i) => out[FEATURED_APPROACHES[a.id][i]].push({ pick: { arm: a.id, run: i }, resolved: r.resolved })));
    return out;
  }, [task, arms]);
  const warned = useMemo(() => {
    if (!task) return [];
    return arms.flatMap((a) => task.results[a.id].runs.map((r, i) => ({ arm: a.id, run: i, resolved: r.resolved, hit: r.hooks.join('\n').includes(COCHANGE) })))
      .filter((x) => x.hit);
  }, [task, arms]);
  const evidence = useMemo(() => task?.results.sensors.runs.find((r) => r.hooks.join('\n').includes(COCHANGE))?.hooks[0] ?? null, [task]);

  const approachPanel = (ap: Approach) => {
    const runs = byApproach[ap];
    const solved = runs.filter((r) => r.resolved).length;
    const cur = shown[ap];
    const run = task?.results[cur.arm].runs[cur.run];
    return (
      <article key={ap} className={`approach approach--${ap}`} aria-labelledby={`ap-${ap}`}>
        <header className="approach__head">
          <p className="approach__k">{ap === 'shortcut' ? 'Approach A' : ap === 'lookahead' ? 'Approach B' : 'Approach C'}</p>
          <h4 id={`ap-${ap}`} className="approach__name">{APPROACH_INFO[ap].name}</h4>
          <p className="approach__count"><strong>{runs.length} run{runs.length === 1 ? '' : 's'}</strong> · {solved} solved</p>
        </header>
        {ap === 'shortcut' && (
          <div className="approach__text">
            <p>{APPROACH_INFO.shortcut.what}</p>
            <pre className="approach__line"><code>{SHORTCUT_LINE}</code></pre>
            <p>It fixes the query in the issue, but it breaks ordinary use of <code>window</code> as a column alias. All {runs.length} shortcut runs failed.</p>
            <p className="approach__src">The failing statement, <code>{ALIAS_QUERY}</code>, is documented in the <a href={DOC_LINKS.readme} target="_blank" rel="noopener noreferrer">README</a> and <a href={DOC_LINKS.phaseLog} target="_blank" rel="noopener noreferrer">PHASE_LOG</a> from the authors' grading logs. The full pytest log is not part of the published data.</p>
          </div>
        )}
        {ap === 'lookahead' && (
          <div className="approach__text">
            <p>{APPROACH_INFO.lookahead.what} The parser inspects the following tokens before deciding how to read <code>WINDOW</code>, so <code>{ALIAS_QUERY}</code> keeps working. All {runs.length} look-ahead runs were solved.</p>
          </div>
        )}
        {ap === 'other' && (
          <div className="approach__text">
            <p>{APPROACH_INFO.other.what} It is neither the shortcut nor a look-ahead, so it is shown on its own. It failed.</p>
          </div>
        )}
        <div className="approach__runs" role="group" aria-label={`${APPROACH_INFO[ap].name} runs`}>
          {runs.map((r) => (
            <button key={`${r.pick.arm}${r.pick.run}`} type="button" aria-pressed={cur.arm === r.pick.arm && cur.run === r.pick.run}
              className={r.resolved ? 'is-ok' : 'is-fail'} onClick={() => setShown((s) => ({ ...s, [ap]: r.pick }))}>
              {label(r.pick.arm)} · R{r.pick.run + 1} <span aria-hidden="true">{r.resolved ? '✓' : '✗'}</span>
              <span className="visually-hidden">{r.resolved ? 'solved' : 'not resolved'}</span>
            </button>
          ))}
        </div>
        {run && (
          <div className="approach__diff">
            <p className="approach__diff-id">
              <span>{label(cur.arm)} · repeat {cur.run + 1}</span>
              <StatusBadge resolved={run.resolved} />
            </p>
            <DiffViewer diff={run.diff} label={`${APPROACH_INFO[ap].name}: ${label(cur.arm)}, repeat ${cur.run + 1}`} preview={ap === 'shortcut' ? 30 : 44} />
          </div>
        )}
      </article>
    );
  };

  return (
    <section id="explorer" ref={root} className="pub worked" aria-labelledby="worked-title">
      <div className="pub-container">
        <header className="pub-head">
          <p className="pub-eyebrow">WINDOW investigation</p>
          <h2 id="worked-title" className="pub-title">One bug. Twelve attempts. Two fundamentally different approaches.</h2>
          <p className="pub-lead">One task reveals why the outcome of a single run cannot establish whether an experimental setup helped.</p>
        </header>

        <div className="worked__bug">
          <div className="worked__explain">
            <h3 className="pub-h3">What went wrong</h3>
            <p>sqlglot incorrectly parsed a query containing a <code>WINDOW</code> clause. Reading it as SQLite, it raised a ParseError on the query from the issue:</p>
            <pre className="worked__sql"><code>{ISSUE_QUERY}</code></pre>
            <p>
              <code>WINDOW</code> can also be an ordinary column alias, so the parser read <code>1 WINDOW</code> as "1, aliased as window" and
              then tripped over <code>a AS (…)</code>. The important compatibility requirement: <code>WINDOW</code> must stay usable as a
              normal alias, so this must keep working:
            </p>
            <pre className="worked__sql worked__sql--keep"><code>{ALIAS_QUERY}</code></pre>
          </div>
          <aside className="worked__card" aria-label="The featured task">
            <p className="worked__card-k">Featured task</p>
            <p className="worked__id">{FEATURED_TASK}</p>
            <p className="worked__title">{task?.title ?? 'Sqlite ParseError: Invalid expression / Unexpected token. for WINDOW'}</p>
            <p className="worked__meta">Fresh bug, fixed upstream in 2026 · 6 conditions × 2 repeats = 12 runs</p>
            {task && <Issue text={task.issue} />}
          </aside>
        </div>

        <ol className="trace" aria-label="From the issue to the graded outcome">
          {TRACE.map(([t, d], i) => <li key={t}><span className="trace__n">{i + 1}</span><strong>{t}</strong><span>{d}</span></li>)}
        </ol>

        {error && <p className="load-error" role="alert">Could not load the task ({error}).</p>}
        {!task ? <div className="pub-skeleton pub-skeleton--board" role="status" aria-busy="true" aria-label="Loading the twelve runs" /> : (
          <>
            <figure className="pub-figure worked__board">
              <p className="pub-figure__title">All twelve runs, by condition</p>
              <RunBoard task={task} arms={arms} a={pick} onSelect={(p) => setPick((cur) => (cur && cur.arm === p.arm && cur.run === p.run ? null : p))}
                approaches={FEATURED_APPROACHES} accordion={!wide} />
              {pick
                ? (
                  <div className="worked__detail">
                    <button type="button" className="ex-more worked__close" onClick={() => setPick(null)}>Close this run</button>
                    <RunPanel run={task.results[pick.arm].runs[pick.run]} armLabel={label(pick.arm)} runIndex={pick.run}
                      taskId={shortId(task.id)} hasHooks={CONDITIONS[pick.arm].hasHooks} collapsible={!wide} />
                  </div>
                )
                : <p className="worked__hint">Select any run to read its patch and the hook messages it received.</p>}
              <figcaption className="caption">
                <span className="caption__n">Figure 4.</span> The twelve runs of <code>{shortId(task.id)}</code>: each condition's two repeats, with
                the result from the repository's real tests and the approach the patch took (read from the diffs). No condition is
                highlighted; select any run to inspect it.
              </figcaption>
            </figure>

            <div className="worked__approaches">
              <h3 className="pub-h3">The approaches the agent took <EvidenceBadge id="E13" /></h3>
              <div className="seg" role="group" aria-label="Approach">
                <button type="button" className="seg__btn" aria-pressed={only === 'all'} onClick={() => setOnly('all')}>All 12</button>
                {(['shortcut', 'lookahead', 'other'] as const).map((ap) => (
                  <button key={ap} type="button" className="seg__btn" aria-pressed={only === ap} onClick={() => setOnly(ap)}>{APPROACH_INFO[ap].name} ({byApproach[ap].length})</button>
                ))}
              </div>
              <div className={`approaches${only === 'all' ? '' : ' is-single'}`}>
                {(only === 'all' || only === 'shortcut') && approachPanel('shortcut')}
                {(only === 'all' || only === 'lookahead') && approachPanel('lookahead')}
                {(only === 'all' || only === 'other') && approachPanel('other')}
              </div>
              <p className="caption"><span className="caption__n">Figure 5.</span> Real patches from <code>results.json</code>. Shortcut and look-ahead are shown side by side; switch to any run of an approach with the buttons above each patch.</p>
            </div>

            <section className={`wcmp${reading ? ' is-reading' : ''}`} aria-label="Compare two runs of this bug">
              <div className="wcmp__bar">
                <h3 className="pub-h3">Compare two runs</h3>
                <ToolButton icon="fit" pressed={reading} onClick={() => setReading(!reading)}>{reading ? 'Exit reading mode' : 'Reading mode'}</ToolButton>
              </div>
              <div className="wcmp__cols">
                {([[left, setLeft, 'First'], [right, setRight, 'Second']] as const).map(([p, set, name]) => {
                  const run = task.results[p.arm].runs[p.run];
                  return (
                    <div key={name} className="wcmp__col">
                      <label className="cc__against">{name} run
                        <select value={`${p.arm}:${p.run}`} onChange={(e) => { const [a, r] = e.target.value.split(':'); set({ arm: a as ArmId, run: Number(r) }); }}>
                          {arms.flatMap((a) => [0, 1].map((r) => (
                            <option key={`${a.id}${r}`} value={`${a.id}:${r}`}>{a.label} · R{r + 1} · {APPROACH_INFO[FEATURED_APPROACHES[a.id][r]].name}</option>
                          )))}
                        </select>
                      </label>
                      <StatusBadge resolved={run.resolved} />
                      <DiffViewer diff={run.diff} label={`${label(p.arm)}, repeat ${p.run + 1}`} preview={reading ? 400 : 40} />
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="worked__why">
              <div className="worked__why-text">
                <h3 className="pub-h3">Why this example matters</h3>
                <p>
                  Tips + hooks went 2/2, while hooks-only went 0/2. That initially looks like a benefit from combining the two. But both
                  conditions received the same kind of generic co-change warnings, including the failed hooks-only runs. The warning did
                  not explain the WINDOW alias bug. The approach taken by the agent, not the setup, is the clearest explanation for the
                  outcomes in this example.
                </p>
                <p className="worked__web">
                  None of the 12 runs accessed the web, according to the documented web audit.
                  <span className="worked__src"> Source: <a href={DOC_LINKS.readme} target="_blank" rel="noopener noreferrer">README</a> and <a href={DOC_LINKS.phaseLog} target="_blank" rel="noopener noreferrer">PHASE_LOG</a> (Phase 7). The published JSON does not include the raw traces behind the audit.</span>
                </p>
              </div>
              <div className="worked__evidence">
                <p className="worked__evidence-k">The hook message, as delivered</p>
                {evidence && <HookMessages hooks={[evidence]} />}
                <p className="worked__evidence-note">General architectural warnings from the repository's history (edit the parser, also check the generator and expressions). They say nothing about aliases or WINDOW.</p>
                <p className="worked__evidence-k">Runs that received this warning</p>
                <ul className="worked__warned">
                  {warned.map((w) => (
                    <li key={`${w.arm}${w.run}`} className={w.resolved ? 'is-ok' : 'is-fail'}>
                      <span>{label(w.arm)} · repeat {w.run + 1}</span><span>{w.resolved ? '✓ Solved' : '✗ Not resolved'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <p className="worked__point" role="note">Different approaches produced different outcomes. This one task cannot establish a causal benefit of any setup.</p>
            <Bridge to="matrix">Now explore all 77 bugs and their 924 runs →</Bridge>
          </>
        )}
      </div>
    </section>
  );
}
