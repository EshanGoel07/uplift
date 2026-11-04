import { useState } from 'react';
import { EvidenceBadge } from '../../components/atlas/Evidence';
import type { ArmId, Summary } from '../../data/types';
import { ci, int, pct, pts, usd } from '../../data/format';
import { winsLosses } from '../../data/classify';
import {
  BOOTSTRAP, BUDGET_CAP, COST_PER_RUN, DETECTABLE, DETECTABLE_MAX, DETECTABLE_MIN,
  HALF_WIDTH_MAX, HALF_WIDTH_MIN, PROJECT_SPEND, RATE_CI, ROBUSTNESS,
} from '../../data/reportFigures';
import { IntervalChart } from '../../components/charts/IntervalChart';
import { Bridge } from '../../components/navigation/Bridge';

/** Short labels for the report's four sensitivity views, in the order of ROBUSTNESS. */
const VIEW_LABEL = ['Full cohort', 'Exposed tasks excluded', 'Own-PR pages excluded too', 'Exposed runs counted as failed'];

export function Results({ summary }: { summary: Summary | null }) {
  const [view, setView] = useState(0);
  const baseline = summary?.arms.find((a) => a.id === 'none');
  const nTasks = summary?.tasks.length ?? 77;

  return (
    <section id="results" className="pub results" aria-labelledby="results-title">
      <div className="pub-container">
        <header className="pub-head">
          <p className="pub-eyebrow">Findings</p>
          <h2 id="results-title" className="pub-title">The setups did not produce a detectable improvement.</h2>
          <p className="pub-lead">
            Each setup is compared with No setup on the same bugs. In the chart below, the dot is the difference in solve
            rate and the line is its 95% paired interval. An interval that crosses zero means the study can't tell that
            setup apart from having none, and every interval does.
          </p>
        </header>

        <div className="results__intro">
          <div className="results__paired">
            <h3 className="pub-h3">Why the comparison is paired</h3>
            <p>
              Every condition was tested on the same {nTasks} bugs. This lets us compare the effect of changing the setup
              rather than comparing unrelated collections of tasks.
            </p>
            <p>
              A hard bug is hard under every condition, so bug difficulty cancels out of each difference. The interval is
              computed by resampling bugs, not runs, because the bug is the unit that was shared.
            </p>
          </div>
          <aside className="sde" aria-labelledby="sde-title">
            <p id="sde-title" className="sde__k">Smallest detectable effect</p>
            <p className="sde__big"><span className="sde__num">{DETECTABLE_MIN}–{DETECTABLE_MAX}</span> percentage points</p>
            <p>
              A real effect had to be about this large to be detected 80% of the time. Smaller real effects could exist
              and go undetected here. A null result means <strong>not shown</strong>, not <strong>shown to be zero</strong>.
            </p>
            <p className="sde__fine">The intervals' half-widths are ±{HALF_WIDTH_MIN} to ±{HALF_WIDTH_MAX} points.</p>
          </aside>
        </div>

        {!summary || !baseline ? <div className="pub-skeleton pub-skeleton--chart" role="status" aria-busy="true" aria-label="Loading results" /> : (
          <>
            <p className="findstrip" aria-label="Findings summary"><span><b>5</b> comparisons</span><span><b>5</b> intervals cross zero</span><span>No detectable difference</span><EvidenceBadge id="E04" /><EvidenceBadge id="E05" /></p>
            <figure className="pub-figure results__figure">
              <p className="pub-figure__title">Difference in solve rate versus No setup, by setup</p>
              <ul className="ic-legend" aria-label="Chart legend">
                <li><i className="lg-dot" aria-hidden="true" /> Estimate</li>
                <li><i className="lg-ci" aria-hidden="true" /> 95% paired interval</li>
                <li><i className="lg-det" aria-hidden="true" /> Smallest effect detectable for that setup</li>
                <li><i className="lg-hatch" aria-hidden="true" /> {DETECTABLE_MIN}–{DETECTABLE_MAX} pts: where effects become reliably detectable</li>
              </ul>
              <div className="seg" role="group" aria-label="Sensitivity view">
                <span className="seg__label">View</span>
                {ROBUSTNESS.map((r, i) => (
                  <button key={r.view} type="button" className="seg__btn" aria-pressed={view === i} onClick={() => setView(i)}>{VIEW_LABEL[i]}</button>
                ))}
              </div>
              {view > 0 && <p className="note" role="status">{ROBUSTNESS[view].view}: {ROBUSTNESS[view].tasks} bugs. These are the report's published sensitivity figures, not a new calculation.<EvidenceBadge id="E06" /></p>}
              <IntervalChart arms={summary.arms} tasks={summary.tasks} describedBy="results-caption" view={view} />
              <figcaption id="results-caption" className="caption">
                <span className="caption__n">Figure 2.</span> Each setup's difference in solve rate from No setup
                ({baseline.solved}/{baseline.attempts} solved, {pct(baseline.rate)}), in percentage points, on the same {nTasks} bugs
                × 2 repeats. Dots are estimates; lines are 95% paired bootstrap intervals ({int(BOOTSTRAP.resamples)} resamples of
                bugs, seed {BOOTSTRAP.seed}). Each interval compares one setup with No setup: overlapping intervals are not a
                test of two setups against each other, and the study did not run that test.
              </figcaption>
            </figure>

            <div className="results__notes">
              <div className="results__takeaway">
                <p className="pub-k">Takeaway</p>
                <p className="results__takeaway-text">
                  No setup was shown to differ from no setup. The generic tips file came out lowest, and its interval also
                  crosses zero. Effects smaller than about {DETECTABLE_MIN}–{DETECTABLE_MAX} points can't be ruled out.
                </p>
              </div>
              <details className="results__explainer">
                <summary>What does a 95% interval mean here?</summary>
                <p>
                  We resampled the {nTasks} bugs with replacement {int(BOOTSTRAP.resamples)} times (seed {BOOTSTRAP.seed}) and
                  recomputed each setup's difference from No setup every time. The middle 95% of those differences is the
                  interval. Because both setups are measured on the same bugs, bug difficulty cancels out. The five comparisons
                  are not adjusted for multiplicity, and the interval ends can move by up to {BOOTSTRAP.ciSeedDrift} points with a
                  different bootstrap seed.
                </p>
              </details>
            </div>

            <div className="results__table">
              <p className="pub-figure__title" id="arm-table-title">Table 1. All six conditions in numbers</p>
              <div className="pub-table-wrap" role="region" aria-labelledby="arm-table-title" tabIndex={0}>
                <table className="pub-table arm-table">
                  <caption id="arm-table-caption">
                    Solved = resolved runs out of {summary.arms[0].attempts} ({nTasks} bugs × 2 repeats). Bugs won / lost = bugs
                    where the setup solved more or fewer of its two repeats than No setup. Regressions = runs that broke a test
                    that passed before. Cost per solved is the setup's whole spend, failed runs included, divided by its solved
                    runs; it has no interval, so read it as descriptive.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Condition</th>
                      <th scope="col" className="num">Solved</th>
                      <th scope="col" className="num">Solve rate<span className="th-sub">95% interval</span></th>
                      <th scope="col" className="num">vs No setup</th>
                      <th scope="col" className="num">95% paired interval</th>
                      <th scope="col" className="num">Detectable at 80% power</th>
                      <th scope="col" className="num">Bugs won / lost</th>
                      <th scope="col" className="num">Cost per solved</th>
                      <th scope="col" className="num">Regressions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.arms.map((a) => {
                      const base = a.id === 'none';
                      const wl = winsLosses(summary.tasks, a.id);
                      const det = DETECTABLE[a.id as Exclude<ArmId, 'none'>];
                      return (
                        <tr key={a.id} className={base ? 'is-baseline' : undefined}>
                          <th scope="row">
                            <span className="arm-name">{a.label}</span>
                            <span className="arm-desc">{a.description}</span>
                          </th>
                          <td className="num">{a.solved}/{a.attempts}</td>
                          <td className="num">{pct(a.rate)}<span className="td-sub">{RATE_CI[a.id][0]}–{RATE_CI[a.id][1]}%</span></td>
                          <td className="num">{base ? <span className="muted">baseline</span> : `${pts(a.diff_vs_none)} pts`}</td>
                          <td className="num">{base ? <span className="muted">n/a</span> : ci(a.ci_low, a.ci_high)}</td>
                          <td className="num">{base ? <span className="muted">n/a</span> : `${det.detectable} pts`}</td>
                          <td className="num">{base ? <span className="muted">n/a</span> : `${wl.won} / ${wl.lost}`}</td>
                          <td className="num">{usd(a.cost_per_solved)}</td>
                          <td className="num">{a.regressions}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <dl className="results__cost">
              <div><dt>Main experiment</dt><dd>{int(summary.summary.runs)} runs for {usd(summary.summary.total_cost_usd, 2)}</dd></div>
              <div><dt>Per run</dt><dd>${COST_PER_RUN.toFixed(3)}</dd></div>
              <div><dt>Whole project</dt><dd>${PROJECT_SPEND.toFixed(2)} of a ${BUDGET_CAP} cap</dd></div>
            </dl>
          </>
        )}
        <Bridge to="method">How was this measured? See the experiment →</Bridge>
      </div>
    </section>
  );
}
