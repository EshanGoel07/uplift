import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArmId, Summary, Task } from '../../data/types';
import { GROUP_LABEL, githubUrl, groupOf, shortId } from '../../data/classify';
import { usd } from '../../data/format';
import { loadTask } from '../../data/load';
import { CONDITIONS } from '../../data/method';
import { atlas, closeInspector, inCompare, openCondition, openRun, pairCheck, taskParam, toggleCompare, useAtlas, type CompareItem } from '../../state/atlasStore';
import { DiffViewer } from '../explorer/DiffViewer';
import { Issue } from '../explorer/Issue';
import { HookMessages, StatusBadge } from '../explorer/RunPanel';
import { EvidenceDetail } from './Evidence';
import { Icon } from './Icon';
import { ConditionTag, EmptyState, Kicker, NOT_PUBLISHED, OutcomeMarker, ToolButton, Unavailable } from './Primitives';

function useTask(id: string | null): { task: Task | null; failed: boolean } {
  const [task, setTask] = useState<Task | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!id) return;
    let on = true;
    setFailed(false);
    loadTask(id).then((t) => { if (on) setTask(t); }).catch(() => { if (on) setFailed(true); });
    return () => { on = false; };
  }, [id]);
  return { task: task && task.id === id ? task : null, failed };
}

function CopyLink({ label = 'Copy link' }: { label?: string }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(window.location.href).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); });
  };
  return <ToolButton icon={done ? 'check' : 'copy'} onClick={copy}>{done ? 'Copied' : label}</ToolButton>;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="meta__row"><dt>{k}</dt><dd>{children}</dd></div>;
}

/** Task Passport: one bug's complete identity record. */
function TaskPassport({ summary }: { summary: Summary }) {
  const id = useAtlas((s) => s.task);
  const compare = useAtlas((s) => s.compare);
  const meta = summary.tasks.find((t) => t.id === id);
  const { task, failed } = useTask(id);
  if (!meta) return <EmptyState title="This bug is not in the study">The link names a task outside the 77 published tasks.</EmptyState>;
  const group = groupOf(meta.solved);
  const gh = githubUrl(meta);
  return (
    <>
      <header className="insp__head">
        <Kicker>Task passport</Kicker>
        <p className="insp__id">{shortId(id)}</p>
        <h2 className="insp__title" id="inspector-title" tabIndex={-1}>{meta.title}</h2>
      </header>
      <dl className="meta">
        <Row k="Dataset">{meta.set === 'test' ? 'Historical (SWE-rebench, 2024)' : 'Fresh (mined, fixed in 2026)'}</Row>
        <Row k="Outcome group"><span className={`g-${group} chip-g`}>{GROUP_LABEL[group]}</span></Row>
        <Row k="Attempts resolved">{meta.total} of 12</Row>
        <Row k="Main-run cost">{usd(meta.cost, 3)}</Row>
        <Row k="Upstream link">{gh ? <a href={gh} target="_blank" rel="noopener noreferrer">sqlglot pull request</a> : <Unavailable>No upstream link recorded for fresh tasks</Unavailable>}</Row>
      </dl>
      <div className="insp__actions">
        <CopyLink />
        <ToolButton icon="layers" onClick={() => { atlas.set({ heroMode: 'runs', inspector: null }, 'push'); document.getElementById('overview')?.scrollIntoView(); }}>Find in the Lattice</ToolButton>
      </div>

      <Kicker as="h3">Twelve attempts</Kicker>
      <table className="attempts">
        <caption className="visually-hidden">Each condition's two repeats for this bug</caption>
        <thead><tr><th scope="col">Condition</th><th scope="col">R1</th><th scope="col">R2</th><th scope="col">Solved</th></tr></thead>
        <tbody>
          {summary.arms.map((a) => {
            const res = task?.results[a.id];
            return (
              <tr key={a.id}>
                <th scope="row"><button type="button" className="linkish" onClick={() => openCondition(a.id)}><ConditionTag id={a.id} label={a.label} /></button></th>
                {[0, 1].map((r) => (
                  <td key={r}>
                    {res
                      ? <button type="button" className="run-cell" aria-label={`${a.label}, repeat ${r + 1}: ${res.runs[r].resolved ? 'solved' : 'failed'}. Open the run.`} onClick={() => openRun(id, a.id, r)}><OutcomeMarker solved={res.runs[r].resolved} /></button>
                      : <span className="run-cell run-cell--wait" aria-hidden="true">·</span>}
                  </td>
                ))}
                <td className="num">{meta.solved[a.id]}/2</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {failed && <EmptyState title="The record could not load">Check the connection and try again.</EmptyState>}
      {task && <div className="insp__issue"><Issue text={task.issue} /></div>}
      <p className="insp__prov"><Icon name="source" size={14} /> {compare.length ? 'Comparison tray in use. ' : ''}From <code>public/data/tasks/{taskParam(id)}</code>, the published export.</p>
    </>
  );
}

/** Run Forensic Inspector: recorded evidence for one attempt. Read-only; nothing here is executing. */
function RunInspector({ summary }: { summary: Summary }) {
  const state = useAtlas((s) => s);
  const { task: id, condition: arm, repeat } = state;
  const { task } = useTask(id);
  if (!arm || repeat === null) return <EmptyState title="No run selected">Choose a condition and a repeat for this bug.</EmptyState>;
  const label = summary.arms.find((a) => a.id === arm)?.label ?? arm;
  const run = task?.results[arm].runs[repeat];
  const item: CompareItem = { kind: 'run', task: id, arm, repeat };
  return (
    <>
      <header className="insp__head">
        <Kicker>Run record</Kicker>
        <p className="insp__id">{shortId(id)} / {arm} / repeat {repeat + 1}</p>
        <h2 className="insp__title" id="inspector-title" tabIndex={-1}><ConditionTag id={arm} label={label} />, repeat {repeat + 1}</h2>
      </header>
      {!run ? <p className="muted">Loading the recorded run…</p> : (
        <>
          <StatusBadge resolved={run.resolved} />
          <dl className="meta">
            <Row k="Run">{shortId(id)}/{arm}/{run.seed}</Row>
            <Row k="Cost">{usd(run.cost_usd, 4)}</Row>
            <Row k="Hook messages delivered">{CONDITIONS[arm].hasHooks ? run.hooks.length : 'none (no hooks in this condition)'}</Row>
            <Row k="Agent exit details"><Unavailable /></Row>
            <Row k="Timestamps"><Unavailable /></Row>
            <Row k="Web-audit tier for this run"><Unavailable>{NOT_PUBLISHED}: totals only, see Integrity</Unavailable></Row>
            <Row k="Pytest log"><Unavailable /></Row>
          </dl>
          <div className="insp__actions">
            <ToolButton icon="compare" pressed={inCompare(state, item)} onClick={() => toggleCompare(item)}>{inCompare(state, item) ? 'In comparison' : 'Add to comparison'}</ToolButton>
            <ToolButton icon="arrow" onClick={() => atlas.set({ inspector: { kind: 'task' } }, 'push')}>All twelve attempts</ToolButton>
            <CopyLink />
          </div>
          <Kicker as="h3">Hook messages</Kicker>
          <HookMessages hooks={run.hooks} hasHooks={CONDITIONS[arm].hasHooks} />
          <Kicker as="h3">Agent patch</Kicker>
          <DiffViewer diff={run.diff} label={`${label}, repeat ${repeat + 1}`} />
          <p className="insp__prov"><Icon name="info" size={14} /> A recorded result, read-only. Nothing is re-run here.</p>
        </>
      )}
    </>
  );
}

function ConditionCard({ summary }: { summary: Summary }) {
  const arm = useAtlas((s) => s.condition);
  if (!arm) return <EmptyState title="No condition selected" />;
  const a = summary.arms.find((x) => x.id === arm)!;
  const spec = CONDITIONS[arm];
  return (
    <>
      <header className="insp__head">
        <Kicker>Condition</Kicker>
        <h2 className="insp__title" id="inspector-title" tabIndex={-1}><ConditionTag id={arm} label={a.label} /></h2>
      </header>
      <p>{a.description}</p>
      <p className="muted">{spec.why}</p>
      <dl className="meta">
        <Row k="Solved">{a.solved} of {a.attempts}</Row>
        <Row k="Files added">{spec.files.length ? spec.files.map((f) => <code key={f} className="file-chip">{f}</code>) : 'None'}</Row>
        <Row k="Cost per solved">{usd(a.cost_per_solved, 4)}</Row>
        <Row k="Regressions">{a.regressions}</Row>
      </dl>
      <div className="insp__actions">
        <ToolButton icon="arrow" onClick={() => { closeInspector(); document.getElementById('conditions')?.scrollIntoView(); }}>Open in Conditions</ToolButton>
        <CopyLink />
      </div>
    </>
  );
}

/** Compares the two tray items, or says why they do not form a matched pair. */
function CompareView({ summary }: { summary: Summary }) {
  const items = useAtlas((s) => s.compare);
  const check = useMemo(() => pairCheck(items), [items]);
  const a = items[0], b = items[1];
  const first = useTask(a?.kind === 'run' ? a.task : null);
  const second = useTask(b?.kind === 'run' ? b.task : null);
  const label = (arm: ArmId) => summary.arms.find((x) => x.id === arm)?.label ?? arm;
  return (
    <>
      <header className="insp__head">
        <Kicker>Comparison</Kicker>
        <h2 className="insp__title" id="inspector-title" tabIndex={-1}>{check.ok ? 'Side by side' : 'Not a matched comparison'}</h2>
      </header>
      {!check.ok && <p className="note note--warn" role="status">{check.reason}</p>}
      {check.ok && a.kind === 'run' && b.kind === 'run' && (
        <div className="cmp">
          {[a, b].map((x, i) => {
            const t = i === 0 ? first.task : second.task;
            const r = t?.results[x.arm].runs[x.repeat];
            return (
              <section key={i} aria-label={`${label(x.arm)}, repeat ${x.repeat + 1}`}>
                <p className="cmp__head"><ConditionTag id={x.arm} label={label(x.arm)} /> · repeat {x.repeat + 1}</p>
                {r ? <><StatusBadge resolved={r.resolved} /><DiffViewer diff={r.diff} label={`${label(x.arm)}, repeat ${x.repeat + 1}`} /></> : <p className="muted">Loading…</p>}
              </section>
            );
          })}
        </div>
      )}
      {check.ok && a.kind === 'condition' && b.kind === 'condition' && (
        <div className="cmp">
          {[a, b].map((x) => {
            const arm = summary.arms.find((y) => y.id === x.arm)!;
            return (
              <section key={x.arm}>
                <p className="cmp__head"><ConditionTag id={x.arm} label={arm.label} /></p>
                <dl className="meta">
                  <Row k="Solved">{arm.solved}/{arm.attempts}</Row>
                  <Row k="Files">{CONDITIONS[x.arm].files.length || 'None'}</Row>
                </dl>
                <p className="muted">{CONDITIONS[x.arm].why}</p>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

/** One contextual inspector for the whole site: a side panel on desktop, a bottom sheet on phones. */
export function InspectorPanel({ summary }: { summary: Summary | null }) {
  const target = useAtlas((s) => s.inspector);
  const panel = useRef<HTMLElement>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!target) return;
    returnTo.current ??= document.activeElement;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !atlas.get().palette) closeInspector(); };
    document.addEventListener('keydown', onKey);
    panel.current?.querySelector<HTMLElement>('#inspector-title')?.focus({ preventScroll: true });
    return () => document.removeEventListener('keydown', onKey);
  }, [target]);
  useEffect(() => {
    if (target) return;
    (returnTo.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    returnTo.current = null;
  }, [target]);

  if (!target || !summary) return null;
  return (
    <aside ref={panel} className="insp" role="dialog" aria-modal="false" aria-labelledby="inspector-title" data-kind={target.kind}>
      <button type="button" className="insp__close" onClick={closeInspector} aria-label="Close the inspector"><Icon name="close" /></button>
      <div className="insp__body">
        {target.kind === 'task' && <TaskPassport summary={summary} />}
        {target.kind === 'run' && <RunInspector summary={summary} />}
        {target.kind === 'condition' && <ConditionCard summary={summary} />}
        {target.kind === 'compare' && <CompareView summary={summary} />}
        {target.kind === 'evidence' && <EvidenceDetail id={target.id} />}
      </div>
    </aside>
  );
}

/** The comparison tray: quiet until something is added. */
export function ComparisonTray({ summary }: { summary: Summary | null }) {
  const items = useAtlas((s) => s.compare);
  const inspecting = useAtlas((s) => !!s.inspector);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!items.length) setOpen(false); }, [items.length]);
  if (!items.length || !summary) return null;
  if (!open) {
    return (
      <div className={`tray tray--pill${inspecting ? ' tray--beside' : ''}`} role="region" aria-label="Comparison tray">
        <button type="button" className="tray__pill" aria-expanded="false" onClick={() => setOpen(true)}>
          <Icon name="compare" size={14} />Compare<b>{items.length}</b>
        </button>
      </div>
    );
  }
  const check = pairCheck(items);
  const name = (c: CompareItem) => {
    const label = summary.arms.find((a) => a.id === c.arm)?.label ?? c.arm;
    return c.kind === 'run' ? `${shortId(c.task)} · ${label} · R${c.repeat + 1}` : label;
  };
  return (
    <div className={`tray${inspecting ? ' tray--beside' : ''}`} role="region" aria-label="Comparison tray">
      <Kicker>Compare</Kicker>
      <ul>
        {items.map((c) => (
          <li key={name(c)}>{name(c)}
            <button type="button" aria-label={`Remove ${name(c)}`} onClick={() => toggleCompare(c)}><Icon name="close" size={12} /></button>
          </li>
        ))}
      </ul>
      <button type="button" className="pbtn pbtn--primary tray__go" onClick={() => atlas.set({ inspector: { kind: 'compare' } }, 'push')} disabled={items.length < 2}>
        {items.length < 2 ? 'Add one more' : check.ok ? 'Compare' : 'Why not?'}
      </button>
      <button type="button" className="tray__close" aria-expanded="true" aria-label="Collapse the comparison tray" onClick={() => setOpen(false)}><Icon name="minus" size={13} /></button>
    </div>
  );
}
