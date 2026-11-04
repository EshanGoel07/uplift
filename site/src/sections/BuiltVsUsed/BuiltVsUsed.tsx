import { DOC_LINKS, NOTICE_URL } from '../../data/links';

// README.md "What we built vs what we used" and "Team". Website libraries: licences read from each
// package.json in node_modules.
const BUILT: [string, string][] = [
  ['Budget guard', 'A spend-capped proxy that allows only Meta models, and a guarded runner that reserves each run\'s worst-case cost first'],
  ['Task loader, date split and leakage checks', 'With positive controls'],
  ['Fresh-task miner', 'Recent sqlglot fix commits that link a GitHub issue'],
  ['Validator', 'Proves each task fails before the fix and passes after, repeated'],
  ['Muse Spark task screening', 'A rule fixed before any result, no overrides'],
  ['Fail-closed grader', 'Parsed counts must match pytest\'s summary'],
  ['Risk map from git history', 'Fix frequency, churn, SZZ bug-introducers, co-change rules'],
  ['Setup generator, arms and hooks', 'Including the generic AGENTS.md, written by us in the style commonly shared online'],
  ['Paid batch runner', 'Every run recorded with its task, condition, repeat and cost'],
  ['Muse Spark tuning and failure labelling', 'Tuning reads dev tasks only'],
  ['Web-leak audit and agent network block', 'The audit of every tool call; the block for new runs'],
  ['Analysis, report and charts', 'Paired bootstrap; results.json is the data export for this page'],
  ['Results website', 'This page'],
];

const USED: [string, string, string][] = [
  ['Muse Code (Meta)', 'The coding agent under test', 'Meta API terms'],
  ['Muse Spark (Meta)', 'Screening, setup generation, tuning, failure labels', 'Meta API terms'],
  ['sqlglot', 'The repository whose bugs are replayed, and the source of the fresh tasks', 'MIT, © Toby Mao'],
  ['SWE-rebench (Nebius)', 'Pre-validated sqlglot bug-fix tasks', 'CC-BY-4.0'],
  ['pyarrow, matplotlib, pytest', 'Data loading, charts, tests', 'Apache-2.0, PSF-based, MIT'],
  ['React, Vite, three.js, React Three Fiber, marked', 'This website', 'MIT'],
  ['DOMPurify', 'Sanitises the issue text shown on this page', 'MPL-2.0 or Apache-2.0'],
  ['GSAP', 'Scroll refresh on this page', 'Standard no-charge licence'],
  ['Geist and Geist Mono', 'Typefaces', 'SIL OFL 1.1'],
];

export function BuiltVsUsed() {
  return (
    <section id="built" className="pub about" aria-labelledby="built-title">
      <div className="pub-container">
        <header className="pub-head">
          <p className="pub-eyebrow">Contribution</p>
          <h2 id="built-title" className="pub-title">What we built, and what we used.</h2>
          <p className="pub-lead">Built for the Meta Global AI Developer Hackathon between Oct 27 and Nov 4, 2026. Everything on the right already existed and is credited here.</p>
        </header>
        <div className="built-grid">
          <div>
            <p className="built-k">Built · Oct 27 – Nov 4, 2026</p>
            <ul className="built-list">
              {BUILT.map(([t, d]) => <li key={t}><span className="built-list__t">{t}</span><span className="built-list__d">{d}</span></li>)}
            </ul>
            <p className="built-team">
              <strong>Eshan Goel</strong>: pipeline, grading, experiments, analysis. <strong>Aryan Kansal</strong>: results website.
            </p>
          </div>
          <div>
            <p className="built-k">Used, not built by us</p>
            <table className="pub-table used-table">
              <thead><tr><th scope="col">What</th><th scope="col">Role</th><th scope="col">Licence</th></tr></thead>
              <tbody>{USED.map(([t, d, l]) => <tr key={t}><th scope="row">{t}</th><td>{d}</td><td>{l}</td></tr>)}</tbody>
            </table>
            <p className="licence-note">
              The issue texts of the 39 SWE-rebench tasks are included under CC-BY-4.0 with attribution; sqlglot’s code and the tasks’
              patches are not redistributed. See <a href={NOTICE_URL} target="_blank" rel="noopener noreferrer">NOTICE.md</a>. Full credits are in the <a href={DOC_LINKS.readme} target="_blank" rel="noopener noreferrer">README</a>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
