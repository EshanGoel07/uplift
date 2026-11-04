import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArmId, Summary } from '../../data/types';
import { FILE_COPIES, LINEAGE, stageOf } from '../../data/lineage';
import { REPO_URL } from '../../data/links';
import { useInView } from '../../hooks/useInView';
import { highlightPython } from '../../utils/highlight';
import { atlas, openCondition, openRun, openTask, useAtlas } from '../../state/atlasStore';
import { condStyle } from '../../utils/condition';
import { EmptyState, Kicker, NOT_PUBLISHED, ToolButton, Unavailable } from '../../components/atlas/Primitives';
import { EvidenceBadge } from '../../components/atlas/Evidence';
import { Icon } from '../../components/atlas/Icon';
import { shortId } from '../../data/classify';
import { PipelineStory } from './PipelineStory';
import { sourcePath, type ModuleInfo } from './types';

type Lens = 'imports' | 'flow' | 'external';

/** The module map: columns follow the pipeline; lines are only what the lens says they are. */
function ModuleMap({ modules, selected, lens, onPick }: { modules: ModuleInfo[]; selected: string; lens: Lens; onPick: (m: string) => void }) {
  const W = 760, rowH = 28;
  const cols = useMemo(() => {
    const by = new Map<number, ModuleInfo[]>();
    for (const m of modules) { const s = stageOf(m.name); by.set(s, [...(by.get(s) ?? []), m]); }
    return [...by.entries()].sort((a, b) => a[0] - b[0]);
  }, [modules]);
  const colW = W / Math.max(1, cols.length);
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach(([, ms], c) => ms.forEach((m, r) => pos.set(m.name, { x: c * colW + colW / 2, y: 24 + r * rowH })));
  const H = 40 + Math.max(...cols.map(([, ms]) => ms.length)) * rowH + (lens === 'external' ? 40 : 0);
  const sel = modules.find((m) => m.name === selected);
  const neighbours = new Set(sel ? [...sel.imports, ...modules.filter((m) => m.imports.includes(selected)).map((m) => m.name)] : []);
  const ext = [...new Set(modules.flatMap((m) => m.external))];
  return (
    <svg className="modmap" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Module map. ${lens === 'imports' ? 'Lines are verified Python imports.' : lens === 'flow' ? 'Dashed lines are the documented pipeline order, not imports.' : 'External packages and the modules that import them.'}`}>
      {lens === 'imports' && modules.flatMap((m) => m.imports.map((t) => {
        const a = pos.get(m.name), b = pos.get(t);
        if (!a || !b) return null;
        const on = m.name === selected || t === selected;
        return <path key={`${m.name}-${t}`} d={`M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`} className={on ? 'modmap__edge is-on' : 'modmap__edge'} />;
      }))}
      {lens === 'flow' && cols.slice(1).map(([, ms], i) => {
        const a = pos.get(cols[i][1][0].name)!, b = pos.get(ms[0].name)!;
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="modmap__flow" />;
      })}
      {lens === 'external' && ext.map((e, i) => {
        const x = (W / (ext.length + 1)) * (i + 1), y = H - 16;
        return (
          <g key={e}>
            {modules.filter((m) => m.external.includes(e)).map((m) => { const a = pos.get(m.name)!; return <line key={m.name} x1={a.x} y1={a.y} x2={x} y2={y} className="modmap__ext" />; })}
            <text x={x} y={y + 4} textAnchor="middle" className="modmap__label modmap__label--ext">{e}</text>
          </g>
        );
      })}
      {modules.map((m) => {
        const p = pos.get(m.name)!;
        const cls = m.name === selected ? 'is-sel' : neighbours.has(m.name) && lens === 'imports' ? 'is-near' : '';
        return (
          <g key={m.name} className={`modmap__node ${cls}`} onClick={() => onPick(m.name)} role="presentation">
            <rect x={p.x - 31} y={p.y - 10} width={62} height={20} rx={4} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" className="modmap__label">{m.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** One module and its direct neighbours. Dependants are the modules whose real imports name it. */
function Neighbourhood({ modules, selected, onPick }: { modules: ModuleInfo[]; selected: string; onPick: (m: string) => void }) {
  const sel = modules.find((m) => m.name === selected);
  if (!sel) return null;
  const W = 760, rowH = 30, X = { left: 130, mid: 380, right: 630 };
  const left = modules.filter((m) => m.imports.includes(selected)).map((m) => ({ name: m.name, copy: false }));
  const right = sel.imports.map((name) => ({ name, copy: false }));
  for (const [from, to] of FILE_COPIES) {
    if (from === selected) right.push({ name: to, copy: true });
    if (to === selected) left.push({ name: from, copy: true });
  }
  const rows = Math.max(left.length, right.length, 1);
  const H = 56 + rows * rowH;
  const yOf = (i: number, n: number) => 44 + (rows - n) * (rowH / 2) + i * rowH;
  const midY = 44 + ((rows - 1) * rowH) / 2;
  const Node = ({ name, x, y, on }: { name: string; x: number; y: number; on?: boolean }) => (
    <g className={`modmap__node${on ? ' is-sel' : ' is-near'}`} role="button" tabIndex={on ? -1 : 0} aria-label={`Open ${name}.py`}
       onClick={() => onPick(name)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(name); } }}>
      <rect x={x - 52} y={y - 11} width={104} height={22} rx={4} />
      <text x={x} y={y + 4} textAnchor="middle" className="modmap__label">{name}</text>
    </g>
  );
  const edge = (x0: number, y0: number, x1: number, y1: number, copy: boolean, key: string) => (
    <path key={key} d={`M${x0},${y0} C${(x0 + x1) / 2},${y0} ${(x0 + x1) / 2},${y1} ${x1},${y1}`} className={copy ? 'modmap__copy' : 'modmap__edge is-on'} />
  );
  return (
    <svg className="modmap modmap--near" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${selected}.py: imported by ${left.length} modules, imports ${right.length}.`}>
      <text x={X.left} y={18} textAnchor="middle" className="modmap__head">Imported by</text>
      <text x={X.right} y={18} textAnchor="middle" className="modmap__head">Imports</text>
      {left.map((m, i) => edge(X.left + 52, yOf(i, left.length), X.mid - 52, midY, m.copy, `l${m.name}`))}
      {right.map((m, i) => edge(X.mid + 52, midY, X.right - 52, yOf(i, right.length), m.copy, `r${m.name}`))}
      {left.map((m, i) => <Node key={`l${m.name}`} name={m.name} x={X.left} y={yOf(i, left.length)} />)}
      {right.map((m, i) => <Node key={`r${m.name}`} name={m.name} x={X.right} y={yOf(i, right.length)} />)}
      <Node name={selected} x={X.mid} y={midY} on />
    </svg>
  );
}

function SourceView({ mod, line }: { mod: ModuleInfo; line: number | null }) {
  const [text, setText] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let on = true;
    setText(null);
    fetch(sourcePath(mod.path)).then((r) => (r.ok ? r.text() : Promise.reject(new Error('missing')))).then((t) => { if (on) setText(t); }).catch(() => { if (on) setText(''); });
    return () => { on = false; };
  }, [mod.path]);
  const lines = useMemo(() => (text ?? '').split('\n'), [text]);
  useEffect(() => {
    if (line === null || !body.current) return;
    const el = body.current.querySelector<HTMLElement>(`[data-l="${line}"]`);
    if (el) body.current.scrollTop = el.offsetTop - 12;
  }, [line, text]);
  if (text === null) return <p className="muted src__wait">Loading {mod.name}.py…</p>;
  if (!text) return <EmptyState title="This file could not load" />;
  return (
    <div className="src__code" ref={body} tabIndex={0} role="region" aria-label={`Source of ${mod.path}`}>
      <table><tbody>
        {lines.map((l, i) => (
          <tr key={i} data-l={i + 1} className={line === i + 1 ? 'is-hit' : undefined}>
            <td className="src__ln">{i + 1}</td>
            <td className="src__tx">{highlightPython(l).map((p, j) => (p.k === 'txt' ? p.t : <span key={j} className={`hl-${p.k}`}>{p.t}</span>))}{'\n'}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

const TOPO = [
  { id: 'dataset', name: 'Research dataset', note: '77 tasks, 39 historical and 38 fresh', evidence: 'published' },
  { id: 'task', name: 'Task', note: 'One real bug, with its issue text', evidence: 'published' },
  { id: 'condition', name: 'Condition', note: 'Six setups, one per lane', evidence: 'audited' },
  { id: 'run', name: 'Run', note: 'Two per task and condition', evidence: 'published' },
  { id: 'agent', name: 'Agent', note: 'Muse Code. Its traces are not published', evidence: 'unavailable' },
  { id: 'patch', name: 'Patch', note: 'Published per run, capped at 30,000 characters', evidence: 'published' },
  { id: 'evaluator', name: 'Evaluator', note: 'The code is public; pytest logs are not', evidence: 'audited' },
  { id: 'outcome', name: 'Outcome', note: 'Resolved or not, per run', evidence: 'published' },
  { id: 'analysis', name: 'Analysis', note: 'Five paired comparisons with No setup', evidence: 'published' },
] as const;
const EV_LABEL = { published: 'Published', audited: 'Partly published', unavailable: 'Not published' } as const;

/** The research structure: what belongs to what. Links are containment and pipeline order, never causes. */
function Topology({ summary }: { summary: Summary }) {
  const [mode, setMode] = useState<'overview' | 'task' | 'condition' | 'evidence'>('overview');
  const task = useAtlas((s) => s.task);
  const cond: ArmId = useAtlas((s) => s.condition) ?? 'both';
  const meta = summary.tasks.find((t) => t.id === task);
  return (
    <div className="topo">
      <div className="seg" role="group" aria-label="Topology mode">
        {([['overview', 'Topology'], ['task', 'Task focus'], ['condition', 'Condition focus'], ['evidence', 'Evidence focus']] as const).map(([m, t]) => (
          <button key={m} type="button" className="seg__btn" aria-pressed={mode === m} onClick={() => setMode(m)}>{t}</button>
        ))}
      </div>
      {(mode === 'overview' || mode === 'evidence') && (
        <ol className="topo__chain">
          {TOPO.map((n) => (
            <li key={n.id} className={mode === 'evidence' ? `is-${n.evidence}` : undefined}>
              <strong>{n.name}</strong>
              <span>{n.note}</span>
              {mode === 'evidence' && <span className="topo__ev">{EV_LABEL[n.evidence]}</span>}
            </li>
          ))}
        </ol>
      )}
      {mode === 'task' && meta && (
        <div>
          <p className="paired__bug"><span className="insp__id">{shortId(task)}</span> {meta.title}</p>
          <ul className="topo__task">
            {summary.arms.map((a) => (
              <li key={a.id} style={condStyle(a.id)}>
                <button type="button" className="linkish" onClick={() => openCondition(a.id)}>{a.label}</button>
                <span>{[0, 1].map((r) => <button key={r} type="button" className="run-cell" aria-label={`${a.label}, repeat ${r + 1}. Open the run.`} onClick={() => openRun(task, a.id, r)}>R{r + 1}</button>)}</span>
                <span className="num">{meta.solved[a.id]}/2 solved</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {mode === 'condition' && (
        <div>
          <div className="lens-conds" role="group" aria-label="Condition">
            {summary.arms.map((a) => <button key={a.id} type="button" className="lens-cond" style={condStyle(a.id)} aria-pressed={cond === a.id} onClick={() => atlas.set({ condition: a.id })}><i aria-hidden="true" />{a.label}</button>)}
          </div>
          <ul className="topo__dots" aria-label="This condition across the 77 bugs">
            {summary.tasks.map((t) => (
              <li key={t.id}><button type="button" data-v={t.solved[cond]} aria-label={`${shortId(t.id)}: ${t.solved[cond]} of 2 solved`} title={`${shortId(t.id)}: ${t.solved[cond]} of 2 solved`} onClick={() => openTask(t.id)} /></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** How the study is built: the pipeline, its real source and the structure of its data. */
export function Architecture({ summary }: { summary: Summary | null }) {
  const root = useRef<HTMLElement>(null);
  const near = useInView(root, '800px 0px');
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [selected, setSelected] = useState('grade');
  const [stage, setStage] = useState(7);
  const [lens, setLens] = useState<Lens>('imports');
  const [wholeMap, setWholeMap] = useState(false);
  const [line, setLine] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!near) return;
    fetch(`${import.meta.env.BASE_URL}data/architecture.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('missing'))))
      .then((d: { modules: ModuleInfo[] }) => setModules(d.modules)).catch(() => setFailed(true));
  }, [near]);
  useEffect(() => {
    const on = (e: Event) => { setSelected((e as CustomEvent<string>).detail); setLine(null); };
    window.addEventListener('uplift:module', on);
    return () => window.removeEventListener('uplift:module', on);
  }, []);

  const pick = (m: string) => { setSelected(m); setLine(null); };
  const mod = modules.find((m) => m.name === selected);
  const s = LINEAGE[stage];
  const needle = q.trim().toLowerCase();
  const list = modules.filter((m) => !needle || m.name.includes(needle) || m.items.some((i) => i.name.toLowerCase().includes(needle)));

  return (
    <section id="architecture" ref={root} className="pub about arch" aria-labelledby="arch-title">
      <div className="pub-container">
        <header className="pub-head">
          <p className="pub-eyebrow">Architecture</p>
          <h2 id="arch-title" className="pub-title">How the study is built, from the source.</h2>
          <p className="pub-lead">Follow the work through five stages, then read the actual Python. The imports below are parsed from the code, not drawn by hand.</p>
        </header>
      </div>
      <PipelineStory />
      <div className="pub-container">
        <details className="arch__more">
        <summary>All ten lineage stages</summary>
        <ol className="ribbon" style={{ ['--done' as string]: stage / (LINEAGE.length - 1) }}>
          {LINEAGE.map((x, i) => (
            <li key={x.id}><button type="button" aria-pressed={stage === i} className={i <= stage ? 'is-past' : undefined} onClick={() => { setStage(i); pick(x.modules[0]); }}><i aria-hidden="true" />{x.name}</button></li>
          ))}
        </ol>
        <div className="ribbon__detail" aria-live="polite">
          <p className="kicker">{s.name}</p>
          <p className="ribbon__what">{s.happens}</p>
          <dl className="meta">
            <div className="meta__row"><dt>Source</dt><dd>{s.modules.map((m) => <button key={m} type="button" className="file-chip linkish" onClick={() => pick(m)}>{m}.py</button>)}</dd></div>
            <div className="meta__row"><dt>Enters</dt><dd>{s.enters}</dd></div>
            <div className="meta__row"><dt>Leaves</dt><dd>{s.leaves}</dd></div>
            <div className="meta__row"><dt>Validated by</dt><dd>{s.validated}</dd></div>
            <div className="meta__row"><dt>Limitation</dt><dd>{s.limit}</dd></div>
          </dl>
          <p className="caption">The line through these stages shows conceptual data flow. It is not a live run, and the study is finished.</p>
        </div>
        </details>

        <h3 id="source-explorer" className="pub-h3 arch__h">Source explorer</h3>
        {failed && <EmptyState title="The source index could not load">The same files are on GitHub.</EmptyState>}
        <div className="srcx">
          <nav className="srcx__tree" aria-label="Source files">
            <label className="mx-search"><Icon name="search" size={14} /><span className="visually-hidden">Search modules and functions</span>
              <input type="search" placeholder="Module or function" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <ul>
              {list.map((m) => <li key={m.name}><button type="button" aria-pressed={m.name === selected} onClick={() => pick(m.name)}><Icon name="file" size={13} />{m.name}.py <span>{m.lines}</span></button></li>)}
              {modules.length > 0 && list.length === 0 && <li><EmptyState title="No matching module" /></li>}
            </ul>
          </nav>
          <div className="srcx__main">
            <div className="srcx__lens seg" role="group" aria-label="Map lens">
              <ToolButton pressed={lens === 'imports'} onClick={() => setLens('imports')}>Verified imports</ToolButton>
              <ToolButton pressed={lens === 'flow'} onClick={() => setLens('flow')}>Documented data flow</ToolButton>
              <ToolButton pressed={lens === 'external'} onClick={() => setLens('external')}>External packages</ToolButton>
            </div>
            {lens === 'imports' && <ToolButton pressed={wholeMap} onClick={() => setWholeMap(!wholeMap)}>{wholeMap ? 'Show one module' : 'Show every module'}</ToolButton>}
            {modules.length > 0 && (lens === 'imports' && !wholeMap
              ? <><Neighbourhood modules={modules} selected={selected} onPick={pick} /><p className="caption">Solid lines are verified Python imports. A dashed line is a file copy, not an import: generate.py installs uplift_hook.py into a workspace.</p></>
              : <ModuleMap modules={modules} selected={selected} lens={lens} onPick={pick} />)}
            {mod && (
              <div className="srcx__source">
                <div className="srcx__head">
                  <div>
                    <code>{mod.path}</code>
                    <p className="muted">{mod.doc}</p>
                    <p className="srcx__deps">Imports: {mod.imports.length ? mod.imports.map((i) => <button key={i} type="button" className="file-chip linkish" onClick={() => pick(i)}>{i}</button>) : 'no other Uplift module'}</p>
                  </div>
                  <a href={`${REPO_URL}/blob/main/${mod.path}`} target="_blank" rel="noopener noreferrer">GitHub <Icon name="external" size={12} /></a>
                </div>
                <div className="srcx__body">
                  <ul className="srcx__fns" aria-label={`Definitions in ${mod.name}.py`}>
                    {mod.items.map((f) => <li key={f.name + f.line}><button type="button" aria-pressed={line === f.line} title={f.doc} onClick={() => setLine(f.line)}><span>{f.name}</span><span className="srcx__line">{f.line}</span></button></li>)}
                  </ul>
                  <SourceView mod={mod} line={line} />
                </div>
              </div>
            )}
          </div>
        </div>
        <p className="note">sqlglot's own commit history, its risk map and the co-change rules: <Unavailable>{NOT_PUBLISHED}</Unavailable> <EvidenceBadge id="E17" /></p>

        <h3 className="pub-h3 arch__h">Research topology</h3>
        <Kicker>What belongs to what. These are structural links, and none of them claims a cause.</Kicker>
        {summary && <Topology summary={summary} />}
      </div>
    </section>
  );
}
