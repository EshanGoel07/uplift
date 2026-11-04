import type { ArmId, Summary } from '../../data/types';
import { isWebLeakCard, trustTitle } from '../../data/classify';
import { signedPoints } from '../../data/format';
import {
  FAILED_RUNS, FAILURE_RULES, GRADER_HIDDEN_FORMATS, HOOK_DELIVERY, NETWORK_BLOCK, REPEAT_DISAGREE, ROBUSTNESS, SCREENING,
  WEB_CHANNELS, WEB_EXPOSED, WEB_EXPOSED_BY_ARM, WEB_EXPOSED_BY_SET, WEB_EXPOSED_DEV, WEB_EXPOSED_SOLVED, WEB_TIERS,
} from '../../data/reportFigures';
import { DOC_LINKS, SOURCE_LINKS } from '../../data/links';
import { Bridge } from '../../components/navigation/Bridge';

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;
const ROB_ARMS = ['prose', 'sensors', 'both', 'handwritten', 'tuned'] as const;

/** Integrity: the checks, the leak we found in our own setup, and what it does and does not change. */
export function Trust({ summary }: { summary: Summary | null }) {
  const label = (id: ArmId) => summary?.arms.find((a) => a.id === id)?.label ?? id;
  const runs = summary?.summary.runs ?? 924;

  return (
    <section id="trust" className="pub integrity" aria-labelledby="trust-title">
      <div className="pub-container">
        <header className="pub-head">
          <p className="pub-eyebrow">Integrity</p>
          <h2 id="trust-title" className="pub-title">We checked for ways the experiment could mislead us.</h2>
          <p className="pub-lead">
            A null result is only worth something if the measurement could have found an effect and was not fooled. These are the
            checks we ran, including a gap we found in our own setup, measured, and reported.
          </p>
        </header>

        <div className="trust-grid">
          {(summary?.trust ?? []).map((c, i) => {
            const leak = isWebLeakCard(c.title);
            return (
              <article key={c.title} className={`trust-card${leak ? ' trust-card--leak' : ''}`}>
                <p className="trust-card__n">{String(i + 1).padStart(2, '0')}</p>
                <h3 className="trust-card__title">{trustTitle(c.title)}</h3>
                <p className="trust-card__detail">{c.detail}</p>
                {leak && (
                  <p className="trust-card__detail trust-card__update">
                    New runs are now blocked from the network. <a href="#web-leak-investigation">The full investigation ↓</a>
                  </p>
                )}
              </article>
            );
          })}
          {!summary && Array.from({ length: 6 }, (_, i) => <div key={i} className="pub-skeleton pub-skeleton--card" />)}
        </div>

        {/* The web-leak investigation, in the order it happened. */}
        <div id="web-leak-investigation" className="investigation">
          <header className="investigation__head">
            <p className="investigation__k">The web-leak investigation</p>
            <h3>{WEB_EXPOSED} of {runs} runs reached the real fix or newer upstream code.</h3>
            <p>That is {(WEB_EXPOSED / runs * 100).toFixed(1)}% of the runs, and a lower bound. Workspaces had no git history, but the agent could still reach the web.</p>
          </header>

          <ol className="timeline">
            <li>
              <h4>The 924 runs used Muse Code's default network configuration</h4>
              <p>Its web tools were on, and its shell's default proxy mode let <code>curl github.com</code> through. Our snapshot checks could not see this.</p>
            </li>
            <li>
              <h4>An audit of every tool call found {WEB_EXPOSED} exposed runs</h4>
              <p>
                <a href={SOURCE_LINKS.webaudit} {...ext}>uplift web-audit</a> read every web fetch and shell command in every trace. {WEB_CHANNELS.webFetchOnly} runs got
                there through web fetch alone, {WEB_CHANNELS.shellOnly} through the shell alone and {WEB_CHANNELS.both} through both; {WEB_EXPOSED_SOLVED} of the {WEB_EXPOSED} were
                solved. URLs built at run time and search snippets are not detected, so the true number may be higher.
              </p>
              <figure className="leak-fig">
                <div className="leak-fig__grid">
                  <div>
                    <p className="leak-fig__k">The furthest each run reached</p>
                    <table className="dk-table tier-table">
                      <thead><tr><th scope="col">Furthest point reached</th><th scope="col" className="num">Runs</th><th scope="col" className="num">Solved</th><th scope="col"><span className="visually-hidden">Share</span></th></tr></thead>
                      <tbody>
                        {WEB_TIERS.map((t) => (
                          <tr key={t.tier} className={t.countsIn80 ? 'is-exposed' : ''}>
                            <th scope="row">{t.tier}{t.countsIn80 && <span className="in80">in the {WEB_EXPOSED}</span>}</th>
                            <td className="num">{t.runs}</td>
                            <td className="num">{t.solved}</td>
                            <td className="bar-col"><span className="tier-bar" style={{ width: `${Math.max(1.5, (t.runs / runs) * 100)}%` }} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <p className="leak-fig__k">Exposed runs per condition (of 154 each)</p>
                    <ul className="arm-bars">
                      {(Object.keys(WEB_EXPOSED_BY_ARM) as ArmId[]).map((id) => (
                        <li key={id}>
                          <span className="arm-bars__name">{label(id)}</span>
                          <span className="arm-bars__track"><span className="arm-bars__fill" style={{ width: `${(WEB_EXPOSED_BY_ARM[id] / 20) * 100}%` }} /></span>
                          <span className="arm-bars__v">{WEB_EXPOSED_BY_ARM[id]}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="dk-fine">
                      Spread evenly across conditions (12 to 16 each). By set: test {WEB_EXPOSED_BY_SET.test.exposed} of {WEB_EXPOSED_BY_SET.test.of}, fresh {WEB_EXPOSED_BY_SET.fresh.exposed} of {WEB_EXPOSED_BY_SET.fresh.of},
                      so the older test bugs were far more exposed and test vs fresh is not a clean comparison. The dev runs the tuned setup
                      learned from were exposed too ({WEB_EXPOSED_DEV.exposed} of {WEB_EXPOSED_DEV.of}).
                    </p>
                  </div>
                </div>
                <figcaption className="caption"><span className="caption__n">Figure 7.</span> Web and shell exposure in the {runs} main runs (<a href={DOC_LINKS.report} {...ext}>reports/main.md</a>). The {WEB_EXPOSED} are the first two rows; another 23 runs reached the task's own PR page or another sqlglot PR or issue and are listed separately.</figcaption>
              </figure>
            </li>
            <li>
              <h4>A sensitivity analysis: the conclusion holds in every view</h4>
              <p>We recomputed every comparison without the exposed tasks, and with every exposed run counted as failed. In all four views, every 95% interval still crosses zero.</p>
              <p className="dk-swipe" aria-hidden="true">Swipe sideways to see all five setups →</p>
              <div className="dk-table-wrap">
                <table className="dk-table robust-table" aria-describedby="robust-cap">
                  <thead>
                    <tr><th scope="col">View</th><th scope="col" className="num">Bugs</th>{ROB_ARMS.map((id) => <th key={id} scope="col" className="num">{label(id)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {ROBUSTNESS.map((r) => (
                      <tr key={r.view}>
                        <th scope="row">{r.view}</th>
                        <td className="num">{r.tasks}</td>
                        {ROB_ARMS.map((id) => {
                          const [d, lo, hi] = r.cells[id];
                          return <td key={id} className="num">{signedPoints(d)}<span className="sub">{signedPoints(lo)} to {signedPoints(hi)}</span></td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Outside the scrolling frame, so it isn't clipped on phones. */}
              <p id="robust-cap" className="caption dk-cap"><span className="caption__n">Table 2.</span> Difference vs No setup in points, with the 95% paired interval, under each view.</p>
              <p className="dk-fine">Solve rates are somewhat inflated by the leak, but the comparison between conditions is not changed by it.</p>
            </li>
            <li>
              <h4>New runs are blocked from the network, verified with a probe</h4>
              <p>Every new agent run gets <code>--sandbox-network restricted</code> with web fetch and web search off. A probe run confirmed it; its shell reported:</p>
              <pre className="probe"><code>{NETWORK_BLOCK.probe}</code></pre>
              <p className="dk-fine">Source: <a href={DOC_LINKS.phaseLog} {...ext}>PHASE_LOG</a> Phase 6 and <a href={SOURCE_LINKS.runner} {...ext}>runner.py</a>.</p>
            </li>
            <li>
              <h4>The 924 runs were not repeated under the block</h4>
              <p>Everything on this page comes from the original runs, reported with the audit above. Blocked runs also cannot install missing test dependencies, so new runs should not be pooled with these.</p>
            </li>
            <li>
              <h4>One gap remains: the filesystem</h4>
              <p>{NETWORK_BLOCK.filesystem}</p>
            </li>
          </ol>
        </div>

        <div className="checks">
          <article className="check">
            <h3>The grader fails closed</h3>
            <p>Only the repository's real tests decide a result. Test files are reset first, and the parsed counts of failed, errored and passed tests must equal pytest's own summary line, or the run cannot pass. That check caught three ways a failure can hide:</p>
            <ol>{GRADER_HIDDEN_FORMATS.map((g) => <li key={g}>{g}</li>)}</ol>
            <p className="dk-fine">Source: <a href={SOURCE_LINKS.grade} {...ext}>grade.py</a></p>
          </article>
          <article className="check">
            <h3>Screened before any result was seen</h3>
            <p>Some benchmark tasks require tests for changes the issue never describes. Muse Spark screened them with a rule fixed before any condition was compared, with no overrides: {SCREENING.excludedF2P} of {SCREENING.ofF2P} FAIL_TO_PASS tests excluded and {SCREENING.droppedTasks} tasks dropped. One task (4516) was probably dropped wrongly and stays dropped.</p>
            <p className="dk-fine">Source: <a href={SOURCE_LINKS.screen} {...ext}>screen.py</a></p>
          </article>
          <article className="check">
            <h3>Contamination controls</h3>
            <ul>
              <li>A date split: setups only learn from the repository as it was before the test period.</li>
              <li>Leakage checks with positive controls: no test-period fix is in the setup snapshots, and the check does fire at HEAD.</li>
              <li>No git history in any workspace, and the repository's own agent files removed.</li>
              <li>Tuning reads dev tasks only; the code refuses test or fresh tasks as tuning input.</li>
            </ul>
            <p className="dk-fine">Source: <a href={SOURCE_LINKS.split} {...ext}>split.py</a>, <a href={SOURCE_LINKS.workspace} {...ext}>workspace.py</a>, <a href={SOURCE_LINKS.tune} {...ext}>tune.py</a></p>
          </article>
          <article className="check">
            <h3>Metered, capped, Meta models only</h3>
            <p>Every run went through a budget proxy with a hard spending cap that refuses any non-Meta model; its ledger total matches the sum of the runs' recorded costs. Hook delivery was checked against each run's trace: {HOOK_DELIVERY.map((h) => `${label(h.arm)} delivered ${h.delivered} messages in ${h.runsWithMessage} runs`).join('; ')}.</p>
            <p className="dk-fine">Source: <a href={SOURCE_LINKS.budgetProxy} {...ext}>budget_proxy.py</a></p>
          </article>
          <article className="check check--wide">
            <h3>Why runs failed: checked facts only</h3>
            <p>{FAILED_RUNS} runs failed. These are rule-based facts from the runs themselves; a run can match several.</p>
            <div className="dk-table-wrap">
              <table className="dk-table">
                <thead><tr><th scope="col">Condition</th><th scope="col" className="num">Failed</th><th scope="col" className="num">Edited none of the fix's files</th><th scope="col" className="num">Broke a passing test</th><th scope="col" className="num">Never ran tests</th><th scope="col" className="num">Hit the step limit</th></tr></thead>
                <tbody>
                  {FAILURE_RULES.map((f) => (
                    <tr key={f.arm}><th scope="row">{label(f.arm)}</th><td className="num">{f.failed}</td><td className="num">{f.noFixFile}</td><td className="num">{f.brokeP2P}</td><td className="num">{f.neverRanTests}</td><td className="num">{f.stepLimit}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="dk-fine">Muse Spark also labelled every failure, but those labels are not verified causes (its "broke other tests" label was used 67 times, 65 of them on runs where every previously passing test still passed), so only the checked facts are shown. Run-to-run noise is real too: the two repeats of a condition disagreed on {REPEAT_DISAGREE.pairs} of {REPEAT_DISAGREE.of} bug-condition pairs.</p>
          </article>
        </div>
        <Bridge to="limitations">What this study cannot tell you →</Bridge>
      </div>
    </section>
  );
}
