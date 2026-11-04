import { DETECTABLE_MAX, DETECTABLE_MIN, NETWORK_BLOCK, WEB_EXPOSED, WEB_EXPOSED_DEV } from '../../data/reportFigures';
import { DOC_LINKS } from '../../data/links';
import { Faq } from '../../components/atlas/Faq';

// README.md "## Limitations" and PHASE_LOG.md (Phases 4-7), grouped; meaning unchanged, nothing left out.
// Artifacts sits before Measurement so the two page columns balance (6 and 7 points).
const GROUPS: { name: string; items: [string, string][] }[] = [
  { name: 'Scope', items: [
    ['One repository', 'Everything was measured on sqlglot. The method is repository-independent, but this study shows it on one repository only.'],
    ['One agent, one budget', 'Muse Code on muse-spark-1.3-contributor, with the same 40-step budget for every condition (Muse starts winding down at step 30), so the verify hook arrives late in that budget.'],
  ] },
  { name: 'Power', items: [
    ['Limited power', `Only effects of about ${DETECTABLE_MIN}–${DETECTABLE_MAX} percentage points could be detected reliably. Smaller real effects cannot be ruled out.`],
    ['Ceiling effect', '43 of 77 bugs were solved by every run of every condition and 11 by none, so only about 23 bugs can show a difference.'],
    ['No multiplicity adjustment', 'The five comparisons with No setup are not adjusted for multiple testing, and the interval ends move by up to 0.65 points with a different bootstrap seed.'],
  ] },
  { name: 'Artifacts', items: [
    ['Detailed artifacts are not published', 'The generated and tuned AGENTS.md texts, the per-run traces and the per-run pytest logs live in a large, git-ignored folder. Per-run outcomes, costs, patches and hook messages are published; claims that rest on the unpublished artifacts are marked on this page.'],
  ] },
  { name: 'Measurement', items: [
    ['Web exposure in the 924 runs', `Agents had web and shell network access: at least ${WEB_EXPOSED} of 924 runs reached the real fix or newer upstream code, mostly on test bugs. Removing them does not change the conclusion, but solve rates are somewhat inflated and test vs fresh is not a clean comparison.`],
    ['Not re-run under the network block', 'Uplift now blocks agent network access for new runs; none of the 924 runs were repeated under it.'],
    ['Filesystem access', NETWORK_BLOCK.filesystem],
    ['Repeats, not seeds', 'The "seed" labels the run but is not passed to the model, so the two repeats are repeated attempts, not controlled random seeds.'],
    ['Tuned on development runs', `The tuned setup was chosen from one-repeat differences on dev tasks, whose runs were themselves exposed to the web (${WEB_EXPOSED_DEV.exposed} of ${WEB_EXPOSED_DEV.of}). It is a hypothesis, not a proven improvement.`],
    ['Late hook feedback', '6 verify blocks fired on the last step and never reached the agent.'],
    ['Screening and start commits', 'The screening rule was fixed before any result, with no overrides: task 4516 was probably dropped wrongly and stays dropped. A global gitignore on the build machine kept a few agent files out of start commits; grading is unaffected.'],
  ] },
];

export function Limitations() {
  let n = 0;
  return (
    <section id="limitations" className="pub about about--limits" aria-labelledby="limits-title">
      <div className="pub-container">
        <header className="pub-head">
          <p className="pub-eyebrow">Limitations</p>
          <h2 id="limits-title" className="pub-title">What this study cannot tell you.</h2>
          <p className="pub-lead">Claims no bigger than the evidence. These are the limits we know about, as listed in the <a href={DOC_LINKS.readme} target="_blank" rel="noopener noreferrer">README</a> and <a href={DOC_LINKS.phaseLog} target="_blank" rel="noopener noreferrer">PHASE_LOG</a>.</p>
        </header>
        <div className="limits">
          {GROUPS.map((g) => (
            <div key={g.name} className="limits__group">
              <h3 className="limits__name">{g.name}</h3>
              <ol className="limits__list">
                {g.items.map(([t, d]) => {
                  n++;
                  return (
                    <li key={t} className="limit">
                      <span className="limit__n">{String(n).padStart(2, '0')}</span>
                      <div><h4 className="limit__t">{t}</h4><p>{d}</p></div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
        <Faq />
      </div>
    </section>
  );
}
