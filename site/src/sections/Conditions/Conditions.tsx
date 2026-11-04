import { useEffect, useMemo, useState } from 'react';
import type { ArmId, Summary, Task } from '../../data/types';
import { shortId } from '../../data/classify';
import { pct } from '../../data/format';
import { loadTask } from '../../data/load';
import { CONDITIONS } from '../../data/method';
import { atlas, inCompare, openRun, toggleCompare, useAtlas } from '../../state/atlasStore';
import { condStyle } from '../../utils/condition';
import { EvidenceBadge } from '../../components/atlas/Evidence';
import { Icon } from '../../components/atlas/Icon';
import { ConditionTag, Kicker, NOT_PUBLISHED, OutcomeMarker, ToolButton, Unavailable } from '../../components/atlas/Primitives';

const COMMON = ['Repository snapshot (no git history)', 'Issue text in the fixed prompt', 'Private .venv with the package and pytest'];

/** Which files' contents are published. Everything else in a generated setup is not. */
const PUBLISHED: Record<string, string> = { 'uplift_hook.py': 'uplift_hook.py' };

function fileSource(arm: ArmId, file: string): string | null {
  if (file === 'AGENTS.md') return arm === 'handwritten' ? 'handwritten-AGENTS.md' : null;
  return PUBLISHED[file.split('/').pop()!] ?? null;
}

function ArtifactViewer({ arm, file }: { arm: ArmId; file: string }) {
  const src = fileSource(arm, file);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    if (!src) return;
    let on = true;
    fetch(`${import.meta.env.BASE_URL}data/source/${src}`).then((r) => (r.ok ? r.text() : null)).then((t) => { if (on) setText(t); }).catch(() => {});
    return () => { on = false; };
  }, [src]);
  return (
    <div className="artifact" aria-label={`Contents of ${file}`}>
      <p className="artifact__path"><Icon name="file" size={14} /><code>{file}</code></p>
      {src
        ? <pre className="artifact__text" tabIndex={0}>{text ?? 'Loading…'}</pre>
        : (
          <div className="artifact__gap">
            <Unavailable>{NOT_PUBLISHED}</Unavailable>
            <p>This condition's file was generated into local working data that was not published. <EvidenceBadge id="E15" /></p>
            <p>What is published: the generator's source, and, for hooks, every message the agent actually received, in each run's record.</p>
          </div>
        )}
    </div>
  );
}

/** Same bug, different conditions, two repeats: the unit the whole study compares. */
function PairedExplorer({ summary }: { summary: Summary }) {
  const id = useAtlas((s) => s.task);
  const state = useAtlas((s) => s);
  const meta = summary.tasks.find((t) => t.id === id)!;
  const [task, setTask] = useState<Task | null>(null);
  useEffect(() => {
    let on = true;
    loadTask(id).then((t) => { if (on) setTask(t); }).catch(() => {});
    return () => { on = false; };
  }, [id]);
  return (
    <div className="paired">
      <Kicker as="h3">Paired experiment</Kicker>
      <p className="paired__flow"><span>Same task</span><Icon name="arrow" size={13} /><span>Different condition</span><Icon name="arrow" size={13} /><span>Two repeats</span></p>
      <p className="paired__bug"><span className="insp__id">{shortId(id)}</span> {meta.title}</p>
      <ul className="paired__rows">
        {summary.arms.map((a) => (
          <li key={a.id} style={condStyle(a.id)}>
            <ConditionTag id={a.id} label={a.label} />
            <span className="paired__reps">
              {[0, 1].map((r) => {
                const run = task?.id === id ? task.results[a.id].runs[r] : null;
                const item = { kind: 'run' as const, task: id, arm: a.id, repeat: r };
                return (
                  <span key={r} className="paired__rep">
                    <button type="button" className="run-cell" disabled={!run} aria-label={`${a.label}, repeat ${r + 1}${run ? (run.resolved ? ': solved' : ': failed') : ''}. Open the run.`} onClick={() => openRun(id, a.id, r)}>
                      {run ? <OutcomeMarker solved={run.resolved} /> : '·'}
                    </button>
                    <button type="button" className="paired__add" aria-pressed={inCompare(state, item)} aria-label={`Add ${a.label}, repeat ${r + 1} to the comparison`} onClick={() => toggleCompare(item)}><Icon name="plus" size={12} /></button>
                  </span>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
      <p className="caption">Select any two runs to compare their patches. Runs of the same bug are a matched comparison; change the bug with the selector at the top of the page, the Nebula, or search.</p>
    </div>
  );
}

/**
 * The six-condition control room: what each condition put in the workspace, shown as real artifacts,
 * with a two-condition comparison. It never shows content that was not published.
 */
export function Conditions({ summary }: { summary: Summary | null }) {
  const selected = useAtlas((s) => s.condition);
  const a: ArmId = selected ?? 'both';
  const [b, setB] = useState<ArmId | null>(null);
  const [lens, setLens] = useState<'all' | 'changed' | 'common'>('all');
  const [file, setFile] = useState<string | null>(null);
  useEffect(() => setFile(null), [a]);

  const spec = CONDITIONS[a], other = b ? CONDITIONS[b] : null;
  const diff = useMemo(() => {
    if (!other) return { onlyA: spec.files, onlyB: [] as string[], shared: [] as string[] };
    return { onlyA: spec.files.filter((f) => !other.files.includes(f)), onlyB: other.files.filter((f) => !spec.files.includes(f)), shared: spec.files.filter((f) => other.files.includes(f)) };
  }, [spec, other]);

  if (!summary) return <section id="conditions" className="pub about" aria-busy="true"><div className="pub-skeleton pub-skeleton--card" /></section>;
  const arm = (id: ArmId) => summary.arms.find((x) => x.id === id)!;

  const col = (id: ArmId, only: string[]) => {
    const s = CONDITIONS[id];
    const x = arm(id);
    return (
      <div className="cc__col" style={condStyle(id)}>
        <p className="cc__name"><ConditionTag id={id} label={x.label} /></p>
        <p className="cc__why">{s.why}</p>
        <dl className="meta">
          <div className="meta__row"><dt>Solved</dt><dd>{x.solved}/{x.attempts} ({pct(x.rate)})</dd></div>
          <div className="meta__row"><dt>Guidance</dt><dd>{s.hasTips ? (id === 'handwritten' ? 'Handwritten' : 'Generated') : 'None'}</dd></div>
          <div className="meta__row"><dt>Hooks</dt><dd>{s.hasHooks ? 'Generated' : 'None'}</dd></div>
        </dl>
        {lens !== 'common' && (
          <>
            <Kicker>Added to the workspace</Kicker>
            {s.files.length === 0 && <p className="muted">Nothing. This is the baseline.</p>}
            <ul className="cc__files">
              {s.files.map((f) => {
                const changed = only.includes(f);
                if (lens === 'changed' && !changed) return null;
                return (
                  <li key={f} className={b && changed ? 'is-diff' : undefined}>
                    <button type="button" aria-pressed={file === `${id}:${f}`} onClick={() => setFile(file === `${id}:${f}` ? null : `${id}:${f}`)}><Icon name="file" size={13} />{f}</button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {lens !== 'common' && (
          <>
            <Kicker>Receives</Kicker>
            <ul className="cc__list">{s.receives.map((r) => <li key={r}>{r}</li>)}</ul>
          </>
        )}
      </div>
    );
  };

  const [fa, ff] = file ? [file.slice(0, file.indexOf(':')) as ArmId, file.slice(file.indexOf(':') + 1)] : [null, null];

  return (
    <section id="conditions" className="pub about conditions" aria-labelledby="conditions-title">
      <div className="pub-container">
        <header className="pub-head">
          <p className="pub-eyebrow">Six conditions</p>
          <h2 id="conditions-title" className="pub-title">What actually changed between the setups.</h2>
          <p className="pub-lead">Each run started from the same repository snapshot and the same prompt. A condition changes only what is installed around them. Pick one, then compare it with another.</p>
        </header>

        <div className="cc">
          <div className="cc__select" role="group" aria-label="Choose a condition">
            {summary.arms.map((x) => (
              <button key={x.id} type="button" className="cc__pick" style={condStyle(x.id)} aria-pressed={a === x.id} onClick={() => atlas.set({ condition: x.id })}>
                <i aria-hidden="true" />{x.label}
              </button>
            ))}
          </div>
          <div className="cc__tools">
            <label className="cc__against">Compare with
              <select value={b ?? ''} onChange={(e) => setB((e.target.value || null) as ArmId | null)}>
                <option value="">Nothing</option>
                {summary.arms.filter((x) => x.id !== a).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </label>
            <div className="seg" role="group" aria-label="What to show">
              <ToolButton pressed={lens === 'all'} onClick={() => setLens('all')}>Everything</ToolButton>
              <ToolButton pressed={lens === 'changed'} onClick={() => setLens('changed')} disabled={!b}>Show what changed</ToolButton>
              <ToolButton pressed={lens === 'common'} onClick={() => setLens('common')}>Show common structure</ToolButton>
            </div>
          </div>

          <div className="cc__common">
            <Kicker>Common to every condition</Kicker>
            <ul>{COMMON.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>

          <div className={`cc__cols${b ? ' is-two' : ''}`}>
            {col(a, diff.onlyA)}
            {b && col(b, diff.onlyB)}
          </div>

          {b && lens !== 'common' && (
            <p className="note" role="status">
              {diff.onlyA.length + diff.onlyB.length === 0
                ? 'These two conditions install the same list of files. What differs is their content.'
                : `${diff.onlyA.length + diff.onlyB.length} file${diff.onlyA.length + diff.onlyB.length === 1 ? '' : 's'} differ${diff.shared.length ? `, and ${diff.shared.length} appear in both, with different generated content where applicable` : ''}.`}
            </p>
          )}
          {fa && ff && <ArtifactViewer arm={fa} file={ff} />}
        </div>

        <PairedExplorer summary={summary} />
      </div>
    </section>
  );
}
