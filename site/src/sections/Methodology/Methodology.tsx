import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Summary } from '../../data/types';
import { loadTask } from '../../data/load';
import { shortId } from '../../data/classify';
import { FEATURED_TASK } from '../../data/reportFigures';
import { live, requestFrame, useUi } from '../../state/sceneStore';
import { sideOf, wb, wbLabels, useWb } from '../../state/workbenchStore';
import { useMedia, WIDE } from '../../hooks/useMedia';
import { useInView } from '../../hooks/useInView';
import { LANES, MODULE_LABELS } from '../../scenes/Workbench/layout';
import { Inspector } from './Inspector';
import { Bridge } from '../../components/navigation/Bridge';
import { DOC_LINKS, SOURCE_LINKS } from '../../data/links';
import { WorkbenchDiagram } from './WorkbenchDiagram';

interface Props { summary: Summary | null; onOpenTask: (id: string) => void }

const MODULE_TEXT: Record<string, string> = {
  A: 'A · Task source', B: 'B · Six conditions × 2 repeats', C: 'C · Isolated workspaces', D: 'D · Information barrier',
  E: 'E · Evaluator', F: 'F · Paired analysis', dev: 'Dev · 40 tasks · tuning only', tests: 'Hidden tests: F2P + P2P',
  agentSide: 'What the agent receives', evalSide: 'What the evaluator uses',
};

/**
 * The experiment, as a workbench: a 3D model in the shared canvas (or an HTML schematic) plus one
 * inspector. Normal scrolling; no pins.
 */
export function Methodology({ summary, onOpenTask }: Props) {
  const webgl = useUi((s) => s.webgl);
  const wide = useMedia(WIDE);
  const view = useWb((s) => s.view);
  const idx = useWb((s) => s.task);
  const focus = useWb((s) => s.focus);
  const side = sideOf(focus);
  const stage = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  // Task files load only when the workbench comes near, never on first paint.
  const near = useInView(root, '600px 0px');
  const use3d = webgl && view === '3d';

  const tasks = useMemo(
    () => (summary ? [...summary.tasks.filter((t) => t.set === 'test'), ...summary.tasks.filter((t) => t.set === 'fresh')] : []),
    [summary],
  );

  // 3D on wide screens with WebGL; the diagram on phones and without WebGL.
  useEffect(() => { wb.set({ view: webgl && wide ? '3d' : '2d' }); }, [webgl, wide]);
  // Start on the featured bug.
  useEffect(() => {
    if (!tasks.length) return;
    wb.set({ task: Math.max(0, tasks.findIndex((t) => t.id === FEATURED_TASK)) });
  }, [tasks]);
  // Real per-run outcomes of the selected bug, from its task file.
  useEffect(() => {
    if (!summary || !tasks[idx] || !near) return;
    let on = true;
    wb.set({ runs: null });
    loadTask(tasks[idx].id).then((t) => {
      if (on) wb.set({ runs: summary.arms.map((a) => t.results[a.id].runs.map((r) => r.resolved)) });
    }).catch(() => {});
    return () => { on = false; };
  }, [idx, tasks, summary, near]);

  // How much of the 3D stage is on screen: this alone wakes the shared canvas (no pinning).
  useEffect(() => {
    const update = () => {
      const el = stage.current;
      if (!el || !use3d) { live.workbenchVis = 0; return; }
      const r = el.getBoundingClientRect();
      const visible = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
      live.workbenchVis = Math.min(1, visible / Math.max(1, Math.min(r.height, window.innerHeight)));
      requestFrame();
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); live.workbenchVis = 0; };
  }, [use3d]);

  const step = (d: number) => wb.set({ task: (idx + d + tasks.length) % tasks.length });
  const label = (k: string, i?: number) => (i !== undefined ? `${i + 1} ${summary?.arms[i].label ?? ''}` : MODULE_TEXT[k]);
  const pressed = (k: string) => {
    const def = MODULE_LABELS.find((l) => l.key === k)?.focus;
    return !!def && def.kind === focus.kind && (def.kind !== 'source' || (focus.kind === 'source' && def.group === focus.group));
  };

  return (
    <section id="method" ref={root} className="pub pub--dark wb-section" aria-labelledby="method-title">
      <div className="pub-container">
        <header className="pub-head">
          <p className="pub-eyebrow">Experiment</p>
          <h2 id="method-title" className="pub-title">How the 924 runs were built, run and graded.</h2>
          <p className="pub-lead">
            Every bug went through six conditions, twice each, in isolated workspaces. The agent saw the issue and its
            setup; only its patch crossed to the evaluator, where the repository's real tests decided the result.
          </p>
        </header>

        {summary && tasks.length > 0 && (
          <div className="wb">
            <div className="wb__toolbar">
              <div className="wb__task">
                <label htmlFor="wb-task" className="wb__tlabel">Bug</label>
                <button type="button" className="wb__step" aria-label="Previous bug" onClick={() => step(-1)}>←</button>
                <select id="wb-task" value={idx} onChange={(e) => wb.set({ task: Number(e.target.value) })}>
                  <optgroup label={`Test (SWE-rebench) · ${tasks.filter((t) => t.set === 'test').length}`}>
                    {tasks.map((t, i) => t.set === 'test' && <option key={t.id} value={i}>{shortId(t.id)} · {t.title.slice(0, 60)}</option>)}
                  </optgroup>
                  <optgroup label={`Fresh (2026) · ${tasks.filter((t) => t.set === 'fresh').length}`}>
                    {tasks.map((t, i) => t.set === 'fresh' && <option key={t.id} value={i}>{shortId(t.id)} · {t.title.slice(0, 60)}</option>)}
                  </optgroup>
                </select>
                <button type="button" className="wb__step" aria-label="Next bug" onClick={() => step(1)}>→</button>
              </div>
              <div className="seg-dark" role="group" aria-label="Information barrier">
                <button type="button" aria-pressed={side === 'agent'} onClick={() => wb.set({ focus: { kind: 'agent' } })}>What the agent sees</button>
                <button type="button" aria-pressed={side === 'evaluator'} onClick={() => wb.set({ focus: { kind: 'evaluator' } })}>What the evaluator sees</button>
              </div>
              {webgl && (
                <div className="seg-dark" role="group" aria-label="View">
                  <button type="button" aria-pressed={view === '3d'} onClick={() => wb.set({ view: '3d' })}>3D view</button>
                  <button type="button" aria-pressed={view === '2d'} onClick={() => wb.set({ view: '2d' })}>2D diagram</button>
                </div>
              )}
              <button type="button" className="wb__reset" onClick={() => wb.set({ focus: { kind: 'overview' } })}>Reset to overview</button>
            </div>

            <div className="wb__body">
              {use3d ? (
                <div className={`wb__stage is-${side}`} ref={stage}>
                  <p className="visually-hidden">
                    3D model of the experiment. Every part shown here is also available as buttons: the labels on the model,
                    the toolbar above and the 2D diagram.
                  </p>
                  <div className="wb__labels">
                    {MODULE_LABELS.map((l) => (
                      <span key={l.key} className={`wb-label wb-label--${l.kind} a-${l.align}`} ref={(el) => { wbLabels[l.key] = el; }}>
                        <button type="button" aria-pressed={pressed(l.key)} onClick={() => l.focus && wb.set({ focus: l.focus })}>
                          {label(l.key)}
                        </button>
                      </span>
                    ))}
                    {Array.from({ length: LANES }, (_, i) => (
                      <span key={i} className="wb-label wb-label--lane a-left" ref={(el) => { wbLabels[`lane${i}`] = el; }}>
                        <button type="button" aria-pressed={(focus.kind === 'lane' || focus.kind === 'run') && focus.arm === summary.arms[i].id}
                          onClick={() => wb.set({ focus: { kind: 'lane', arm: summary.arms[i].id } })}>
                          {label('', i)}
                        </button>
                      </span>
                    ))}
                  </div>
                  <p className="wb__hint">Select any labelled part, a lane, a workspace or a result lamp.</p>
                </div>
              ) : (
                <WorkbenchDiagram summary={summary} tasks={tasks} />
              )}
              <Inspector summary={summary} tasks={tasks} onOpenTask={onOpenTask} />
            </div>
          </div>
        )}

        <div className="wb-method">
          <h3 className="pub-h3">The method, technically</h3>
          <p className="wb-method__lead">The workbench above shows the structure. Each step below links to the code that implements it.</p>
          <ol className="wb-method__steps">
            {([
              ['Task selection', <>The SWE-rebench sqlglot tasks are split by date: the newest 40 are the test set and the 40 before them are dev. A further 40 fresh tasks are mined from sqlglot fixes made between April and October 2026 that link a GitHub issue.</>, [['split.py', SOURCE_LINKS.split], ['mine.py', SOURCE_LINKS.mine]]],
              ['Task validation', <>A task counts only if, on every repeat, a FAIL_TO_PASS test fails before the fix and all FAIL_TO_PASS and PASS_TO_PASS tests pass after it.</>, [['runner.py', SOURCE_LINKS.runner]]],
              ['Test screening', <>Muse Spark judged whether the issue describes each required test, under a rule fixed before any result. 38 of 164 FAIL_TO_PASS tests were excluded and 4 tasks dropped, leaving 39 test and 38 fresh bugs.</>, [['screen.py', SOURCE_LINKS.screen]]],
              ['Setup generation', <>One Muse Spark call writes the tips file and a hook spec from the repository before the cutoff; Uplift renders the hooks. The generic file is written by us; the tuned setup is rewritten from dev results only.</>, [['generate.py', SOURCE_LINKS.generate], ['tune.py', SOURCE_LINKS.tune], ['generic AGENTS.md', DOC_LINKS.genericAgents]]],
              ['Isolated workspaces', <>A git archive of the base commit with one new commit and no history; the repository's own agent files removed; only the assigned setup installed; a private virtual environment.</>, [['workspace.py', SOURCE_LINKS.workspace]]],
              ['Agent execution', <>Muse Code runs with the same prompt in every condition: at most 40 model steps and 2,400 seconds, every call metered through a hard-capped proxy. Each bug runs twice per condition: 924 runs.</>, [['runner.py', SOURCE_LINKS.runner], ['budget_proxy.py', SOURCE_LINKS.budgetProxy]]],
              ['Grading', <>Test files reset, the hidden test patch applied, FAIL_TO_PASS and PASS_TO_PASS run in an isolated pytest config. Parsed results must match pytest's summary line, or the run cannot pass.</>, [['grade.py', SOURCE_LINKS.grade]]],
              ['Statistical analysis', <>Per bug and condition, the share of its 2 runs solved. Each condition minus No setup, averaged over bugs, with a paired bootstrap over the 77 bugs (10,000 resamples, seed 20261101), the 95% interval, and the effect detectable at 80% power. No multiplicity adjustment.</>, [['analysis.py', SOURCE_LINKS.analysis], ['reports/main.md', DOC_LINKS.report]]],
            ] as [string, ReactNode, [string, string][]][]).map(([title, body, src]) => (
              <li key={title} className="method-step">
                <strong>{title}</strong>
                <span>{body}</span>
                <span className="method-step__src">
                  {src.map(([n, href], i) => <span key={n}>{i ? ' · ' : ''}<a href={href} target="_blank" rel="noopener noreferrer">{n}</a></span>)}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <Bridge to="explorer">See it on one real bug, run by run →</Bridge>
      </div>
    </section>
  );
}
