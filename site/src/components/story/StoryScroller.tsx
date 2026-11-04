import { useEffect, type ReactNode } from 'react';
import { useStorySteps } from './useStorySteps';

export interface StoryStep { title: string; body: ReactNode }

interface Props {
  steps: StoryStep[];
  /** Names the steps for assistive technology. */
  label: string;
  /** The persistent visual. It stays in view beside the steps on wide screens. */
  stage: (active: number) => ReactNode;
  /** Narrow screens drop the stage and show this figure inside each step instead. */
  figure?: (step: number) => ReactNode;
  /** True when the persistent stage is in use. */
  sticky: boolean;
  /** A name for each step, exposed on the stage for the story's state. */
  states?: readonly string[];
  onStep?: (active: number) => void;
}

/**
 * A vertical story: short steps flowing in the document beside a stage that stays in view through CSS
 * `position: sticky`. Only the stage holds still, and the page scrolls as usual. The step text carries the
 * whole meaning, so the story reads the same with no stage at all.
 */
export function StoryScroller({ steps, label, stage, figure, sticky, states, onStep }: Props) {
  const { active, bind, select } = useStorySteps(steps.length);
  useEffect(() => { onStep?.(active); }, [active, onStep]);

  return (
    <div className={`story${sticky ? ' story--sticky' : ''}`} data-state={states?.[active]}>
      {sticky && (
        <div className="story__stage">
          {stage(active)}
          <ol className="story__rail" aria-label={`${label}: steps`}>
            {steps.map((s, i) => (
              <li key={s.title}>
                <button type="button" aria-label={`Step ${i + 1}: ${s.title}`} aria-current={i === active ? 'step' : undefined} onClick={() => select(i)}>{i + 1}</button>
              </li>
            ))}
          </ol>
        </div>
      )}
      <ol className="story__steps" aria-label={label}>
        {steps.map((s, i) => (
          <li key={s.title} ref={bind(i)} className={`story__step${i === active ? ' is-active' : ''}`} data-step={i}>
            {!sticky && figure?.(i)}
            <div className="story__card">
              <h3 className="story__title">{s.title}</h3>
              <div className="story__body">{s.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
