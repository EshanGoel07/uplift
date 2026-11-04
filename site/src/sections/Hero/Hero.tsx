import type { Summary } from '../../data/types';
import { int, usd } from '../../data/format';
import { DETECTABLE_MAX, DETECTABLE_MIN } from '../../data/reportFigures';
import { jumpTo } from '../../components/navigation/Nav';
import { HeroStage } from '../../components/figures/HeroStage';

interface Props { summary: Summary | null; onOpenTask: (id: string) => void }

/** Opening of the publication: the question, the answer, and all 924 runs as a 3D lattice. */
export function Hero({ summary, onOpenTask }: Props) {
  const s = summary?.summary;
  const runs = s ? int(s.runs) : '924';
  const tasks = s ? String(s.tasks) : '77';
  const stats = [
    { value: runs, label: 'experimental runs' },
    { value: tasks, label: 'real bugs from sqlglot' },
    { value: summary ? String(summary.arms.length) : '6', label: 'experimental conditions' },
    { value: s ? usd(s.total_cost_usd, 2) : '$21.31', label: 'main experiment cost' },
  ];

  return (
    <section id="overview" className="pub hero" aria-labelledby="hero-title">
      <div className="pub-container">
        <p className="hero__kicker">A measured study of coding-agent setups on <span className="hero__repo">{s?.repo ?? 'tobymao/sqlglot'}</span></p>
        <h1 id="hero-title" className="hero__title">Do coding‑agent setups actually help?</h1>
        <div className="hero__grid">
          <div className="hero__main">
            <p className="hero__lead">
              We built an experimental system to investigate whether instructions and runtime hooks improve an AI coding
              agent's ability to fix real software bugs.
            </p>
            <div className="hero__finding" role="note" aria-label="Central finding">
              <p className="hero__finding-k">Central finding</p>
              <p className="hero__finding-text">
                Across {runs} runs on {tasks} real bugs, no setup was shown to differ from no setup.
              </p>
              <p className="hero__finding-q">
                This does not establish that the effects are zero. The study could reliably detect effects of
                approximately {DETECTABLE_MIN}–{DETECTABLE_MAX} percentage points at 80% power.
              </p>
            </div>
            <div className="hero__actions">
              <a className="pbtn pbtn--primary" href="#results" onClick={(e) => { e.preventDefault(); jumpTo('results'); }}>Read the findings</a>
              <a className="pbtn" href="#explorer" onClick={(e) => { e.preventDefault(); jumpTo('explorer'); }}>See the worked example</a>
            </div>
            <dl className="hero__stats" aria-label="The study at a glance">
              {stats.map((x) => (
                <div className="stat" key={x.label}>
                  <dt className="stat__label">{x.label}</dt>
                  <dd className="stat__num">{x.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="hero__figure">
            {summary
              ? <HeroStage summary={summary} onOpenTask={onOpenTask} />
              : <div className="lattice lattice--loading" role="status" aria-busy="true" aria-label="Loading the run lattice" />}
          </div>
        </div>

        <div className="hero__facts">
          <div className="hero__credits">
            <dl className="hero__models">
              <div><dt>Muse Code</dt><dd>The coding agent under test</dd></div>
              <div><dt>Muse Spark</dt><dd>Screened the tasks, generated and tuned the setups, labelled failures</dd></div>
            </dl>
            <p className="hero__byline">By Eshan Goel and Aryan Kansal <span className="nowrap">· November 2026</span></p>
            <p className="hero__event">Built for the Meta Global AI Developer Hackathon, Oct 27 – Nov 4, 2026</p>
          </div>
        </div>
      </div>
    </section>
  );
}
