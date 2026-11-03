import { useState } from 'react';
import type { ArmId, Summary } from '../../data/types';
import { ci, int, pct, pts, usd } from '../../data/format';
import { winsLosses } from '../../data/classify';
import { ARM_INFO } from '../../data/arms';
import {
  BOOTSTRAP, BUDGET_CAP, COST_PER_RUN, DETECTABLE, DETECTABLE_MAX, DETECTABLE_MIN,
  HALF_WIDTH_MAX, HALF_WIDTH_MIN, PROJECT_SPEND, RATE_CI,
} from '../../data/reportFigures';
import { IntervalChart } from '../../components/charts/IntervalChart';
import { SectionHead } from '../../components/interface/SectionHead';

export function Results({ summary }: { summary: Summary | null }) {
  const [selected, setSelected] = useState<ArmId[]>([]);
  const toggle = (id: ArmId) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)));

  return (
    <section id="results" className="section results" aria-labelledby="results-title">
      <div className="container">
        <SectionHead index="01" eyebrow="Headline result" id="results-title" title="No setup was shown to differ from no setup."
          lead="Each setup is compared with No setup on the same 77 bugs (a paired comparison). The dot is the difference in solve rate; the line is its 95% interval. An interval that crosses zero means the study can't tell that setup apart from having none." />

        {!summary ? <div className="skeleton skeleton--chart" role="status" aria-busy="true" aria-label="Loading results" /> : (
          <>
            <div className="results__chart card">
              <div className="card__bar">
                <span className="label">Paired difference vs No setup · 95% bootstrap interval · {int(BOOTSTRAP.resamples)} resamples</span>
                <span className="label label--muted">Click rows to compare two setups</span>
              </div>
              <IntervalChart arms={summary.arms} tasks={summary.tasks} selected={selected} onToggle={toggle} describedBy="arm-table-caption" />
              <div className="results__legend" aria-hidden="true">
                <span><i className="lg lg--dot" /> estimate</span>
                <span><i className="lg lg--ci" /> 95% interval</span>
                <span><i className="lg lg--det" /> smallest effect detectable for that setup</span>
                <span><i className="lg lg--hatch" /> 5.4–9.1 pts: where real effects become reliably detectable</span>
              </div>
            </div>

            <div className="results__notes">
              <aside className="callout callout--ember">
                <p className="label">Smallest detectable effect</p>
                <p className="callout__big">A real effect needs to be about <strong className="mono">{DETECTABLE_MIN}–{DETECTABLE_MAX}</strong> percentage points to be detected 80% of the time.</p>
                <p>The intervals' half-widths are ±{HALF_WIDTH_MIN} to ±{HALF_WIDTH_MAX} points, so smaller real effects can't be ruled out. A null result here means "not shown", not "shown to be zero".</p>
              </aside>
              <aside className="callout">
                <p className="label">Takeaway</p>
                <p className="callout__big">No setup was shown to differ from no setup. The generic tips file came out lowest. Smaller real effects under about 5–9 points can't be ruled out.</p>
              </aside>
              <details className="callout explainer">
                <summary>What does a 95% interval mean here?</summary>
                <p>We resampled the 77 tasks with replacement {int(BOOTSTRAP.resamples)} times (seed {BOOTSTRAP.seed}) and recomputed each setup's difference from No setup every time. The middle 95% of those differences is the interval. Because both arms are measured on the same tasks, task difficulty cancels out. The five comparisons are not adjusted for multiplicity, and the interval ends can move by up to {BOOTSTRAP.ciSeedDrift} points with a different bootstrap seed.</p>
              </details>
            </div>

            {selected.length > 0 && <Compare summary={summary} ids={selected} onClear={() => setSelected([])} />}

            <div className="table-wrap">
              <table className="data-table arm-table">
                <caption id="arm-table-caption">All six setups. Solved = resolved runs out of 154 (77 bugs × 2 repeats). Regressions = runs that broke a test that passed before. Won/lost = bugs where the setup solved more or fewer of its two repeats than No setup.</caption>
                <thead>
                  <tr>
                    <th scope="col">Setup</th>
                    <th scope="col" className="num">Solved</th>
                    <th scope="col" className="num">Rate</th>
                    <th scope="col" className="num">vs none</th>
                    <th scope="col" className="num">95% interval</th>
                    <th scope="col" className="num">Won / lost</th>
                    <th scope="col" className="num">Cost / solved</th>
                    <th scope="col" className="num">Regressions</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.arms.map((a) => {
                    const wl = winsLosses(summary.tasks, a.id);
                    const base = a.id === 'none';
                    const sel = selected.includes(a.id);
                    return (
                      <tr key={a.id} className={`${base ? 'is-baseline' : ''}${sel ? ' is-selected' : ''}`}>
                        <th scope="row">
                          <span className="arm-name">{a.label}</span>
                          <span className="arm-desc">{ARM_INFO[a.id].detail}</span>
                        </th>
                        <td className="num mono">{a.solved}/{a.attempts}</td>
                        <td className="num mono">{pct(a.rate)}<span className="sub">{RATE_CI[a.id][0]}–{RATE_CI[a.id][1]}%</span></td>
                        <td className="num mono">{base ? <span className="muted">baseline</span> : `${pts(a.diff_vs_none)} pts`}</td>
                        <td className="num mono">{base ? <span className="muted">n/a</span> : ci(a.ci_low, a.ci_high)}</td>
                        <td className="num mono">{base ? <span className="muted">n/a</span> : `${wl.won} / ${wl.lost}`}</td>
                        <td className="num mono">{usd(a.cost_per_solved)}</td>
                        <td className="num mono">{a.regressions > 0 ? <span className="badge badge--warn">{a.regressions}</span> : a.regressions}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="cost-strip">
              <div><p className="label">Cost of the study</p><p className="cost-strip__big mono">{int(summary.summary.runs)} agent runs on real bugs for {usd(summary.summary.total_cost_usd, 2)}</p></div>
              <div><p className="label">Per run</p><p className="cost-strip__big mono">${COST_PER_RUN.toFixed(3)}</p></div>
              <div><p className="label">Whole project</p><p className="cost-strip__big mono">Total project spend ${PROJECT_SPEND.toFixed(2)} of a ${BUDGET_CAP} cap</p></div>
              <p className="cost-strip__note">Cost per solved bug is the setup's whole spend, failed runs included, divided by its solved runs. Differences between setups are small and have no interval, so read them as descriptive.</p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Compare({ summary, ids, onClear }: { summary: Summary; ids: ArmId[]; onClear: () => void }) {
  const arms = ids.map((id) => summary.arms.find((a) => a.id === id)!);
  return (
    <div className="compare card" role="region" aria-label="Setup comparison" aria-live="polite">
      <div className="card__bar">
        <span className="label">Comparing {arms.length === 1 ? 'one setup (select another)' : 'two setups'}</span>
        <button type="button" className="btn btn--small btn--ghost" onClick={onClear}>Clear</button>
      </div>
      <div className="compare__grid">
        {arms.map((a) => {
          const wl = winsLosses(summary.tasks, a.id);
          const det = DETECTABLE[a.id as Exclude<ArmId, 'none'>];
          return (
            <div key={a.id} className="compare__col">
              <p className="compare__name">{a.label}</p>
              <dl className="kv kv--wide">
                <dt>Solved</dt><dd className="mono">{a.solved}/{a.attempts} · {pct(a.rate)}</dd>
                <dt>vs No setup</dt><dd className="mono">{pts(a.diff_vs_none)} pts</dd>
                <dt>95% interval</dt><dd className="mono">{ci(a.ci_low, a.ci_high)}</dd>
                <dt>Won / lost</dt><dd className="mono">{wl.won} / {wl.lost}</dd>
                <dt>Detectable at 80%</dt><dd className="mono">{det ? `${det.detectable} pts` : 'n/a'}</dd>
                <dt>Cost / solved</dt><dd className="mono">{usd(a.cost_per_solved)}</dd>
                <dt>Regressions</dt><dd className="mono">{a.regressions}</dd>
              </dl>
            </div>
          );
        })}
      </div>
      {arms.length === 2 && (
        <p className="compare__note">Each interval compares a setup with No setup. Overlapping intervals are not a test of these two setups against each other, and the study did not run that test.</p>
      )}
    </div>
  );
}
