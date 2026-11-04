import { useEffect, useMemo, useRef } from 'react';
import type { Summary } from '../../data/types';
import { shortId } from '../../data/classify';
import { FEATURED_TASK } from '../../data/reportFigures';
import { useMedia, WIDE } from '../../hooks/useMedia';
import { jumpTo } from '../../components/navigation/Nav';
import { StoryScroller, type StoryStep } from '../../components/story/StoryScroller';
import { cohort, setCohortStage } from '../../state/cohortStore';
import { scenes, useScenes, useUi } from '../../state/sceneStore';
import { condStyle } from '../../utils/condition';
import { StoryFigure } from './StoryFigure';

interface Props { summary: Summary | null }

const FORMULA: Partial<Record<number, string>> = {
  2: '1 bug × 6 conditions × 2 repeats = 12 attempts',
  4: '77 bugs × 6 conditions × 2 repeats = 924 runs',
};

/** How it works opens here: one bug becomes twelve attempts, and twelve become the whole study. */
export function OneBugStory({ summary }: Props) {
  const webgl = useUi((s) => s.webgl);
  const failed = useUi((s) => s.cohort3dFailed);
  const reduced = useUi((s) => s.reducedMotion);
  const wide = useMedia(WIDE);
  const use3d = webgl && wide && !failed;
  const stage = useRef<HTMLDivElement>(null);
  const mounted = useScenes(() => scenes.get('cohort').mounted);

  const ordered = useMemo(() => (summary ? [...summary.tasks.filter((t) => t.set === 'test'), ...summary.tasks.filter((t) => t.set === 'fresh')] : []), [summary]);
  const task = ordered.find((t) => t.id === FEATURED_TASK);

  // The scene loads as the reader approaches, never during page start-up; the 2D figure covers the wait.
  // The stage exists only once the page has its data, so its position here is the real one.
  useEffect(() => {
    const el = stage.current;
    if (!summary || !use3d || !el) return;
    cohort.tasks = ordered;
    cohort.arms = summary.arms;
    cohort.focus = Math.max(0, ordered.findIndex((t) => t.id === FEATURED_TASK));
    let release: (() => void) | undefined;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !release) release = scenes.request('cohort', el, { reducedMotion: 'static', lowTier: false });
    }, { rootMargin: '500px 0px' });
    io.observe(el);
    return () => { io.disconnect(); release?.(); };
  }, [summary, use3d, ordered]);
  useEffect(() => { cohort.reduced = reduced; }, [reduced]);

  const steps: StoryStep[] = useMemo(() => !summary ? [] : [
    {
      title: 'One real bug.',
      body: <p>This is <code>{task ? shortId(task.id) : 'one bug'}</code>{task ? `: ${task.title}.` : '.'} It is one of the {summary.tasks.length} real sqlglot bugs in the study, shown as an example rather than a typical case.</p>,
    },
    {
      title: 'Six conditions.',
      body: <p>The same bug ran under six conditions, from nothing added to generated tips and hooks. They are parallel arms, not stages: each starts again from the same snapshot.</p>,
    },
    {
      title: 'Two repeats.',
      body: <p>Each condition attempted the bug twice, so one bug gives twelve attempts.</p>,
    },
    {
      title: 'Now every bug.',
      body: <p>Pull back and those twelve attempts are one column. The same six conditions and two repeats hold for all {summary.tasks.length} bugs, so every condition is compared on exactly the same bugs.</p>,
    },
    {
      title: '924 runs.',
      body: (
        <>
          <p>Every tile is one run. This picture shows the study's design, not the order the runs happened in.</p>
          <p className="story__action">
            <a className="pbtn pbtn--primary" href="#conditions" onClick={(e) => { e.preventDefault(); jumpTo('conditions', { step: true }); }}>Compare all six conditions</a>
          </p>
        </>
      ),
    },
  ], [summary, task]);

  if (!summary) return <section id="story" className="pub onebug" aria-busy="true" />;

  return (
    <section id="story" className="pub onebug" aria-labelledby="story-title">
      <div className="pub-container">
        <header className="pub-head">
          <p className="pub-eyebrow">How it works</p>
          <h2 id="story-title" className="pub-title">From one bug to 924 attempts.</h2>
          <p className="onebug__skip">
            <a href="#matrix" onClick={(e) => { e.preventDefault(); jumpTo('matrix', { step: true }); }}>Skip to the full dataset</a>
          </p>
        </header>
      </div>

      <StoryScroller
        label="From one bug to 924 attempts"
        steps={steps}
        sticky={wide}
        onStep={setCohortStage}
        stage={(active) => (
          <>
            <div className="story__canvas" ref={stage} aria-hidden="true">
              {(!use3d || !mounted) && <StoryFigure stage={active} summary={summary} title={steps[active].title} />}
              {use3d && (
                <div className={`story__labels${mounted ? '' : ' is-waiting'}`}>
                  {summary.arms.map((a, r) => (
                    <span key={a.id} className={`story__label${active === 1 || active === 2 ? ' is-on' : ''}`} style={condStyle(a.id)} ref={(el) => { cohort.labels[r] = el; }}>{a.label}</span>
                  ))}
                  <span className={`story__label story__label--bug${active === 0 ? ' is-on' : ''}`} ref={(el) => { cohort.labels[summary.arms.length] = el; }}>{task ? shortId(task.id) : ''}</span>
                </div>
              )}
            </div>
            {FORMULA[active] && <p className="story__formula">{FORMULA[active]}</p>}
          </>
        )}
        figure={(i) => <StoryFigure stage={i} summary={summary} title={steps[i].title} />}
      />
    </section>
  );
}
