import { DETECTABLE_MAX, DETECTABLE_MIN } from '../../data/reportFigures';

const ITEMS: [string, string][] = [
  ['Why were there six conditions?', 'They separate the questions. No setup is the baseline. Generated tips, generated hooks and both together test repo-specific help. A generic file tests advice not tied to the repository. A tuned setup tests one round of adjustment on separate dev tasks.'],
  ['What were the two repeats?', 'The agent is not deterministic, so each condition ran twice on each bug. A bug\'s score under a condition is the share of its two runs that passed: 0, ½ or 1.'],
  ['Why were tests hidden?', 'If the agent could see the tests, a pass would say less about whether it understood the bug. The agent saw the issue and the code; the tests from the real fix were applied only at grading.'],
  ['What is a paired confidence interval?', 'Every condition ran on the same bugs, so each is compared with No setup bug by bug, which cancels out how hard a bug is. Resampling the bugs 10,000 times gives the range shown. If that range includes zero, the study cannot tell the condition apart from No setup.'],
  ['What does the web-exposure audit mean?', 'After the runs, the authors checked what each run had fetched. 80 of the 924 runs reached the real fix or newer upstream code, which is a lower bound. The conclusion holds with those removed. New runs are now blocked from the network except for the model API, but these 924 were not re-run.'],
  ['What are the study\'s limitations?', `One repository, one agent, and two repeats. Effects smaller than about ${DETECTABLE_MIN}–${DETECTABLE_MAX} points could exist and go undetected. The filesystem stayed readable, and the comparisons are not adjusted for multiplicity.`],
];

export function Faq() {
  return (
    <div className="faq">
      <h3 className="pub-h3">Questions readers ask</h3>
      {ITEMS.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
    </div>
  );
}
