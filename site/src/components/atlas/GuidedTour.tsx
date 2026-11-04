import { useEffect } from 'react';
import { DETECTABLE_MAX, DETECTABLE_MIN } from '../../data/reportFigures';
import { atlas, useAtlas } from '../../state/atlasStore';
import { jumpTo } from '../navigation/Nav';
import { Kicker, ToolButton } from './Primitives';

export const TOUR = [
  ['overview', 'The question', 'Do coding-agent setups make agents better at fixing real bugs? This study measured it.'],
  ['overview', '77 bugs', 'Each node in the Nebula is one real sqlglot bug.'],
  ['conditions', 'Six conditions', 'The same bug ran under six setups, from nothing at all to generated guidance and hooks.'],
  ['conditions', 'Two repeats', 'Every condition ran twice on every bug, so 77 × 6 × 2 = 924 runs.'],
  ['method', 'An isolated workspace', 'Each run started from a snapshot with no git history. A condition only changed what was installed around it.'],
  ['method', 'The information barrier', 'The agent saw the issue and the code. The hidden tests arrived only after it had finished.'],
  ['method', 'Grading', 'Hidden tests from the real fix decided the result, and the grader fails closed.'],
  ['results', 'The result', 'All five intervals cross zero: none of the five setups was shown to differ from running with none.'],
  ['limitations', 'The limits', `Effects smaller than about ${DETECTABLE_MIN}–${DETECTABLE_MAX} points remain unresolved, and agents could reach the web in these runs.`],
] as const;

/** An optional walk through the study. It scrolls to each stop and never locks the page. */
export function GuidedTour() {
  const step = useAtlas((s) => s.tour);
  useEffect(() => { if (step !== null) jumpTo(TOUR[step][0]); }, [step]);
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') atlas.set({ tour: null }, 'none'); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step]);
  if (step === null) return null;
  const [, title, text] = TOUR[step];
  const go = (t: number | null) => atlas.set({ tour: t }, 'none');
  return (
    <aside className="tour" role="dialog" aria-modal="false" aria-label="Guided tour">
      <Kicker>Step {step + 1} of {TOUR.length}</Kicker>
      <p className="tour__title">{title}</p>
      <p className="tour__text" aria-live="polite">{text}</p>
      <div className="tour__nav">
        <ToolButton disabled={step === 0} onClick={() => go(step - 1)}>Previous</ToolButton>
        {step < TOUR.length - 1 ? <ToolButton onClick={() => go(step + 1)}>Next</ToolButton> : <ToolButton onClick={() => go(null)}>Finish</ToolButton>}
        <button type="button" className="tour__skip" onClick={() => go(null)}>Skip tour</button>
      </div>
    </aside>
  );
}
