import { SectionHead } from '../../components/interface/SectionHead';

// SUBMISSION.md, "Limitations to state honestly", shortened without changing meaning.
const LIMITS: [string, string][] = [
  ['One repository, one agent', 'Everything was measured on sqlglot with Muse Code (muse-spark-1.3-contributor). Other repos or agents may behave differently.'],
  ['Ceiling effect', '43 of 77 bugs were solved by every run of every setup and 11 by none, so only about 23 bugs can show a difference.'],
  ['A 40-step budget', 'Every setup had the same 40-step budget (Muse starts winding down at step 30), so the verify hook often arrives late; 6 verify blocks fired on the last step and never reached the agent.'],
  ['Seeds are repeats', 'The seed labels the run but is not passed to the model, so the two repeats are repeated attempts, not controlled random seeds.'],
  ['The tuned setup is a hypothesis', 'It was chosen from one-repeat differences on dev tasks, so it is not a proven improvement.'],
  ['Web access', 'Agents had web and shell network access: at least 80 of 924 runs reached the real fix or newer upstream code, 12 to 16 per setup and mostly on test bugs. Removing them does not change the conclusion, but solve rates are somewhat inflated and test vs fresh is not a clean comparison.'],
  ['No multiplicity adjustment', 'The five comparisons with No setup are not adjusted for multiple testing.'],
  ['Interval ends move slightly', 'The 95% intervals can move by up to 0.65 points with a different bootstrap seed.'],
];

const ALSO: string[] = [
  'The screening rule was fixed before seeing results, with no overrides: task 4516 was probably dropped wrongly and stays dropped.',
  "A global gitignore on the build machine kept a few agent files (CLAUDE.md, .claude/, .cursor/) out of start commits; grading is unaffected.",
];

export function Limitations() {
  return (
    <section id="limitations" className="section limits-section" aria-labelledby="limits-title">
      <div className="container">
        <SectionHead index="07" eyebrow="Limitations" id="limits-title" title="What this study can't tell you."
          lead="Claims no bigger than the evidence. These are the limits we know about, in plain words." />
        <ol className="limits">
          {LIMITS.map(([t, d], i) => (
            <li key={t} className="limit">
              <span className="limit__n mono">{String(i + 1).padStart(2, '0')}</span>
              <div><h3 className="limit__t">{t}</h3><p>{d}</p></div>
            </li>
          ))}
        </ol>
        <div className="limits-also">
          <p className="label">Also</p>
          <ul>{ALSO.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      </div>
    </section>
  );
}
