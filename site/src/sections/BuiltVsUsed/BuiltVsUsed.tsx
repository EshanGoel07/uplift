import { SectionHead } from '../../components/interface/SectionHead';

const BUILT: [string, string][] = [
  ['Budget guard', 'A hard-capped spending proxy that only allows Meta models, with a ledger'],
  ['Task loader and split', 'Date split into dev and test, with the setup snapshot fixed before the test period'],
  ['Leakage checks', 'Proves no test-period fix is in the snapshot, with positive controls'],
  ['Fresh-task miner', 'Turns 2026 sqlglot fix commits with a linked issue into new tasks'],
  ['Validator', 'Proves each task is real: fails before the fix, passes after, repeated'],
  ['Fail-closed grader', "Real tests only; parsed counts must match pytest's summary"],
  ['Risk map', 'Fix frequency, churn, SZZ-lite and co-change rules from git history'],
  ['Setup generator', 'Muse Spark writes the setup; Uplift renders always-valid hooks'],
  ['Arms and hooks', 'Six setups, including a generic control and a tuned variant'],
  ['Batch runner', 'Plans, runs and records every run with task, arm, repeat and cost'],
  ['Analysis and report', 'Paired bootstrap, web-leak audit, failure facts and charts'],
  ['Results website', 'This page: the data split, charts, matrix, explorer and 3D scenes'],
];

const USED: [string, string, string][] = [
  ['sqlglot', 'The repository whose past bugs we replay, and the source of the fresh tasks', 'MIT, © Toby Mao'],
  ['SWE-rebench', "Pre-validated sqlglot bug-fix tasks (Nebius)", 'CC-BY-4.0'],
  ['Muse Code', 'The coding agent under test (muse-spark-1.3-contributor)', 'Meta'],
  ['Muse Spark', 'Setup generator, tuner, task screener and failure labeller', 'Meta'],
];

export function BuiltVsUsed() {
  return (
    <section id="built" className="section built-section" aria-labelledby="built-title">
      <div className="container">
        <SectionHead index="06" eyebrow="What we built vs what we used" id="built-title" title="Built during the event. Standing on these."
          lead="Everything on the left was built for this hackathon, between Oct 29 and Nov 4, 2026, by Aryan Kansal and Eshan Goel. Everything on the right already existed and is credited here." />
        <div className="built-grid">
          <div className="built-col">
            <p className="label label--ember">Built · Oct 29 – Nov 4, 2026</p>
            <ul className="built-list">
              {BUILT.map(([t, d]) => (
                <li key={t}><span className="built-list__t">{t}</span><span className="built-list__d">{d}</span></li>
              ))}
            </ul>
            <p className="built-team">Team: <strong>Aryan Kansal</strong> and <strong>Eshan Goel</strong></p>
          </div>
          <div className="built-col built-col--used">
            <p className="label">Used</p>
            <ul className="used-list">
              {USED.map(([t, d, l]) => (
                <li key={t}>
                  <span className="used-list__t">{t}</span>
                  <span className="used-list__d">{d}</span>
                  <span className="used-list__l mono">{l}</span>
                </li>
              ))}
            </ul>
            <p className="fine">Neither sqlglot nor the SWE-rebench data is redistributed in the Uplift repository; both are downloaded at run time. See NOTICE.md.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
