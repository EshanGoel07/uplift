import { useState } from 'react';
import type { ArmId, Summary } from '../../data/types';
import { isWebLeakCard, trustTitle } from '../../data/classify';
import { signedPoints } from '../../data/format';
import {
  FAILED_RUNS, FAILURE_RULES, GRADER_HIDDEN_FORMATS, HOOK_DELIVERY, REPEAT_DISAGREE, ROBUSTNESS, SCREENING, STALE_BYTECODE,
  WEB_EXPOSED, WEB_EXPOSED_BY_ARM, WEB_EXPOSED_BY_SET, WEB_EXPOSED_DEV, WEB_EXPOSED_SOLVED, WEB_TIERS,
} from '../../data/reportFigures';
import { scheduleRefresh } from '../../hooks/useGsap';
import { SectionHead } from '../../components/interface/SectionHead';

const ICONS = [
  // snapshot, fresh, split, grader, web, meter
  'M3 4h10v8H3zM3 7h10M6 4v8', 'M8 2v12M2 8h12M4 4l8 8M12 4l-8 8', 'M8 2v12M3 5h3M3 8h3M3 11h3M10 5h3M10 8h3M10 11h3',
  'M3 3h10v10H3zM5.5 8l2 2 3.5-4', 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12', 'M2 12a6 6 0 0 1 12 0M8 12l3-4',
];

export function Trust({ summary }: { summary: Summary | null }) {
  const [open, setOpen] = useState(false);
  const toggle = () => { setOpen(!open); scheduleRefresh(); };
  const label = (id: ArmId) => summary?.arms.find((a) => a.id === id)?.label ?? id;

  return (
    <section id="trust" className="section trust-section" aria-labelledby="trust-title">
      <div className="container">
        <SectionHead index="04" eyebrow="The integrity lab" id="trust-title" title="Why you can trust the numbers."
          lead="A null result is only worth something if the measurement could have found an effect, and wasn't fooled. These are the checks, including the gap we found in our own setup." />

        <div className="trust-grid">
          {(summary?.trust ?? []).map((c, i) => {
            const leak = isWebLeakCard(c.title);
            return (
              <article key={c.title} className={`trust-card${leak ? ' trust-card--leak' : ''}`}>
                <div className="trust-card__head">
                  <svg viewBox="0 0 16 16" aria-hidden="true" className="trust-card__icon"><path d={ICONS[i % ICONS.length]} /></svg>
                  <span className="label mono">0{i + 1}</span>
                </div>
                <h3 className="trust-card__title">{trustTitle(c.title)}</h3>
                <p className="trust-card__detail">{c.detail}</p>
                {leak && (
                  <button type="button" className="btn btn--small btn--ember-ghost" aria-expanded={open} aria-controls="web-leak-investigation" onClick={toggle}>
                    {open ? 'Close the investigation' : 'Open the investigation'}
                  </button>
                )}
              </article>
            );
          })}
          {!summary && Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton skeleton--card" />)}
        </div>

        <div id="web-leak-investigation" className={`investigation${open ? ' is-open' : ''}`} hidden={!open}>
          <header className="investigation__head">
            <p className="label label--ember">Investigation · web access</p>
            <h3>{WEB_EXPOSED} of 924 runs reached the real fix or newer upstream code.</h3>
            <p>Workspaces had no git history, but Muse Code has web tools and its shell had network access, and nothing blocked them. Our snapshot checks couldn't see the web. We found the gap ourselves, audited every tool call, and showed the result holds without the exposed runs.</p>
          </header>

          <div className="investigation__grid">
            <div>
              <p className="label">The furthest each run reached</p>
              <table className="data-table tier-table">
                <thead><tr><th scope="col">Most the run reached</th><th scope="col" className="num">Runs</th><th scope="col" className="num">Solved</th><th scope="col" className="tier-bar-col"><span className="visually-hidden">Share of runs</span></th></tr></thead>
                <tbody>
                  {WEB_TIERS.map((t) => (
                    <tr key={t.tier} className={t.countsIn80 ? 'is-exposed' : ''}>
                      <th scope="row">{t.tier}{t.countsIn80 && <span className="badge badge--ember">in the 80</span>}</th>
                      <td className="num mono">{t.runs}</td>
                      <td className="num mono">{t.solved}</td>
                      <td className="tier-bar-col"><span className="tier-bar" style={{ width: `${Math.max(1.5, (t.runs / 924) * 100)}%` }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="fine">
                The 80 are the first two rows (59 + 21); {WEB_EXPOSED_SOLVED} of them were solved. Another 23 runs reached the task's own PR page (7) or another sqlglot PR or issue (16); they are listed separately and are not part of the 80.
                This is a lower bound: URLs built at run time and search snippets are not detected. The solve-rate gap between exposed and unexposed runs is partly easy tasks, so it doesn't measure how much the leak helped.
              </p>
            </div>
            <div>
              <p className="label">Exposed runs per setup (of 154 each)</p>
              <ul className="arm-bars">
                {(Object.keys(WEB_EXPOSED_BY_ARM) as ArmId[]).map((id) => (
                  <li key={id}>
                    <span className="arm-bars__name">{label(id)}</span>
                    <span className="arm-bars__track"><span className="arm-bars__fill" style={{ width: `${(WEB_EXPOSED_BY_ARM[id] / 20) * 100}%` }} /></span>
                    <span className="mono">{WEB_EXPOSED_BY_ARM[id]}</span>
                  </li>
                ))}
              </ul>
              <p className="fine">Spread evenly: 12 to 16 per setup, at most 2.6 points apart. By set: test {WEB_EXPOSED_BY_SET.test.exposed} of {WEB_EXPOSED_BY_SET.test.of} runs, fresh {WEB_EXPOSED_BY_SET.fresh.exposed} of {WEB_EXPOSED_BY_SET.fresh.of}. The older test bugs are far more exposed, which clouds the test vs fresh comparison. The dev runs the tuned setup learned from were exposed too ({WEB_EXPOSED_DEV.exposed} of {WEB_EXPOSED_DEV.of}).</p>
            </div>
          </div>

          <div className="investigation__robust">
            <p className="label">Does the result survive? Difference vs No setup, points (95% interval)</p>
            <div className="table-wrap">
              <table className="data-table robust-table">
                <thead>
                  <tr>
                    <th scope="col">View</th><th scope="col" className="num">Tasks</th>
                    {(['prose', 'sensors', 'both', 'handwritten', 'tuned'] as const).map((id) => <th key={id} scope="col" className="num">{label(id)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ROBUSTNESS.map((r) => (
                    <tr key={r.view}>
                      <th scope="row">{r.view}</th>
                      <td className="num mono">{r.tasks}</td>
                      {(['prose', 'sensors', 'both', 'handwritten', 'tuned'] as const).map((id) => {
                        const [d, lo, hi] = r.cells[id];
                        return (
                          <td key={id} className="num mono">
                            {signedPoints(d)}<span className="sub">{signedPoints(lo)} to {signedPoints(hi)}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="investigation__verdict"><span className="status status--ok"><span aria-hidden="true">✓</span> Holds</span> In every view, every 95% interval still crosses zero. Solve rates are somewhat inflated by the leak, but the comparison between setups is not changed by it.</p>
          </div>
        </div>

        <div className="trust-more">
          <article className="trust-detail">
            <h3>The grader fails closed</h3>
            <p>Only the repo's real tests decide a result. Test files are reset first, and the parsed counts of failed, errored and passed tests must equal pytest's own summary line, or the run can't pass. That check caught three hidden-failure formats:</p>
            <ol className="tight">{GRADER_HIDDEN_FORMATS.map((g) => <li key={g}>{g}</li>)}</ol>
            <p className="fine">Also caught in testing: {STALE_BYTECODE}</p>
          </article>
          <article className="trust-detail">
            <h3>Screened before any result was seen</h3>
            <p>Some benchmark bugs require tests for changes the issue never describes. Muse Spark screened them with a rule fixed before any setup was compared, with no overrides: it excluded {SCREENING.excludedF2P} of {SCREENING.ofF2P} FAIL_TO_PASS tests and dropped {SCREENING.droppedTasks} of {SCREENING.ofTasks} tasks. One task (4516) was probably dropped wrongly and stays dropped.</p>
          </article>
          <article className="trust-detail">
            <h3>Metered, capped, Meta models only</h3>
            <p>Every run went through a budget proxy with a hard spending cap that refuses any non-Meta model. Its ledger total matches the sum of the runs' recorded costs. Hooks were checked against each run's trace: {HOOK_DELIVERY.map((h) => `${label(h.arm)} delivered ${h.delivered} messages in ${h.runsWithMessage} runs`).join('; ')}. A few verify blocks fired on the last step and never reached the agent.</p>
          </article>
          <article className="trust-detail">
            <h3>Why runs failed: checked facts</h3>
            <p>{FAILED_RUNS} runs failed. These are rule-based facts from the runs themselves (a run can match several):</p>
            <div className="table-wrap">
              <table className="data-table compact-table">
                <thead><tr><th scope="col">Setup</th><th scope="col" className="num">Failed</th><th scope="col" className="num">Edited none of the fix's files</th><th scope="col" className="num">Broke a passing test</th><th scope="col" className="num">Never ran tests</th><th scope="col" className="num">Hit the step limit</th></tr></thead>
                <tbody>
                  {FAILURE_RULES.map((f) => (
                    <tr key={f.arm}><th scope="row">{label(f.arm)}</th><td className="num mono">{f.failed}</td><td className="num mono">{f.noFixFile}</td><td className="num mono">{f.brokeP2P}</td><td className="num mono">{f.neverRanTests}</td><td className="num mono">{f.stepLimit}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="fine">Muse Spark also labelled each failure, but those labels are not verified causes: its "broke other tests" label was used 67 times, 65 of them on runs where every previously passing test still passed. We show only the checked facts. Run-to-run noise is real too: the two repeats of one setup disagreed on {REPEAT_DISAGREE.pairs} of {REPEAT_DISAGREE.of} bug-setup pairs.</p>
          </article>
        </div>
      </div>
    </section>
  );
}
