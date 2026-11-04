import type { Summary } from '../../data/types';
import { int, usd } from '../../data/format';
import { DETECTABLE_MAX, DETECTABLE_MIN } from '../../data/reportFigures';
import { jumpTo } from '../../components/navigation/Nav';
import { atlas } from '../../state/atlasStore';
import { HeroStage } from '../../components/figures/HeroStage';

interface Props { summary: Summary | null }

/** Opening of the publication: the question, the answer, and all 924 runs as a 3D lattice. */
export function Hero({ summary }: Props) {
  const s = summary?.summary;
  const runs = s ? int(s.runs) : '924';
  const tasks = s ? String(s.tasks) : '77';
  const stats = [
    { value: tasks, label: 'real sqlglot bugs' },
    { value: summary ? String(summary.arms.length) : '6', label: 'conditions' },
    { value: '2', label: 'repeats' },
    { value: runs, label: 'runs' },
    { value: s ? usd(s.total_cost_usd, 2) : '$21.31', label: 'main experiment cost' },
  ];

  return (
    <section id="overview" className="pub hero" aria-labelledby="hero-title">
      <div className="pub-container">
        <div className="hero__grid">
          <div className="hero__main">
            <p className="pub-eyebrow">An experiment in agent configuration</p>
            <h1 id="hero-title" className="hero__title">Do coding‑agent setups actually make agents better at fixing real bugs?</h1>
            <p className="hero__lead">
              We tested six experimental conditions on {tasks} real sqlglot bugs, running Meta's Muse Code agent twice under every condition.
            </p>
            <div className="hero__finding" role="note" aria-label="Central finding">
              <p className="hero__finding-k">Research conclusion</p>
              <p className="hero__finding-text">No setup was shown to differ from no setup.</p>
              <p className="hero__finding-q">
                The study could reliably detect differences of approximately {DETECTABLE_MIN}–{DETECTABLE_MAX} percentage
                points at 80% power. Smaller effects remain unresolved.
              </p>
            </div>
            <div className="hero__actions">
              <a className="pbtn pbtn--primary" href="#method" onClick={(e) => { e.preventDefault(); jumpTo('method'); }}>Explore the experiment</a>
              <a className="pbtn" href="#explorer" onClick={(e) => { e.preventDefault(); jumpTo('explorer'); }}>Investigate the WINDOW bug</a>
              <button type="button" className="pbtn hero__tour" onClick={() => atlas.set({ tour: 0 }, 'none')}>Guided tour</button>
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
              ? <HeroStage summary={summary} />
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
