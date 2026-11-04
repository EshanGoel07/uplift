import { useEffect, useMemo, useRef } from 'react';
import type { ArmId, Summary } from '../../data/types';
import { shortId } from '../../data/classify';
import { FEATURED_TASK } from '../../data/reportFigures';
import { useInView } from '../../hooks/useInView';
import { useMedia, WIDE } from '../../hooks/useMedia';
import { jumpTo } from '../../components/navigation/Nav';
import { StoryScroller, type StoryStep } from '../../components/story/StoryScroller';
import { cohort, setCohortStep, type CohortStep } from '../../state/cohortStore';
import { scenes, useUi } from '../../state/sceneStore';
import { condStyle } from '../../utils/condition';

interface Props { summary: Summary | null }

/** One line per condition, from src/data/method.ts. The conditions are introduced one at a time to teach them. */
const CONDITION_LINE: Record<ArmId, string> = {
  none: 'The baseline. The agent gets the issue and the code, and nothing else. Every other condition is compared with this one.',
  prose: 'A 13-line AGENTS.md, written by Muse Spark from the repository\'s docs, history and review comments.',
  sensors: 'No written guidance. Hooks give the agent lint, co-change and verify feedback while it works.',
  both: 'The same generated tips file and hooks, installed together.',
  handwritten: 'A 60-line best-practice AGENTS.md, written in the style commonly shared online. Nothing in it is specific to sqlglot.',
  tuned: 'An 11-line AGENTS.md with lint and verify hooks, rewritten by Muse Spark after reading results from separate dev bugs only.',
};

/** What the scene shows at each step. */
const BEATS: CohortStep[] = [
  { lanes: 0, repeats: false, cohort: false },
  { lanes: 1, repeats: false, cohort: false },
  { lanes: 2, repeats: false, cohort: false },
  { lanes: 3, repeats: false, cohort: false },
  { lanes: 4, repeats: false, cohort: false },
  { lanes: 5, repeats: false, cohort: false },
  { lanes: 6, repeats: false, cohort: false },
  { lanes: 6, repeats: false, cohort: false },
  { lanes: 6, repeats: true, cohort: false },
  { lanes: 6, repeats: true, cohort: true },
];

const FORMULA: Partial<Record<number, string>> = {
  8: '1 bug × 6 conditions × 2 repeats = 12 attempts',
  9: '77 bugs × 6 conditions × 2 repeats = 924 runs',
};

/** The same beat in 2D, for phones and for browsers without WebGL. It is drawn from the study's dimensions. */
function StoryFigure({ beat, summary, title }: { beat: CohortStep; summary: Summary; title: string }) {
  const arms = summary.arms;
  const W = 340, H = 200, top = 22, pitch = (H - top * 2) / (arms.length - 1);
  const y = (r: number) => top + r * pitch;
  if (beat.cohort) {
    const cols = summary.tasks.length, cw = W / cols;
    return (
      <svg className="story__figure" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {arms.map((a, r) => (
          <g key={a.id}>
            <line x1="0" x2={W} y1={y(r)} y2={y(r)} style={{ stroke: `var(--cond-${a.id})` }} strokeWidth="1" opacity="0.7" />
            {[0, 1].map((q) => <line key={q} x1="0" x2={W} y1={y(r) + (q ? 5 : -5)} y2={y(r) + (q ? 5 : -5)} stroke="var(--text-2)" strokeWidth="6" strokeDasharray={`${cw * 0.62} ${cw * 0.38}`} opacity="0.5" />)}
          </g>
        ))}
      </svg>
    );
  }
  const x0 = 26, x1 = W - 34;
  return (
    <svg className="story__figure" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
      {arms.slice(0, beat.lanes).map((a, r) => (
        <g key={a.id}>
          <path d={`M${x0} ${H / 2} C ${(x0 + x1) / 2} ${H / 2}, ${(x0 + x1) / 2} ${y(r)}, ${x1} ${y(r)}`} fill="none" style={{ stroke: `var(--cond-${a.id})` }} strokeWidth="1.5" />
          {beat.repeats && [0, 1].map((q) => <rect key={q} x={x1 + 4} y={y(r) - 9 + q * 10} width="20" height="8" rx="2" fill="var(--ember)" />)}
        </g>
      ))}
      <circle cx={x0} cy={H / 2} r="7" fill="var(--ember)" />
    </svg>
  );
}

const onStep = (i: number): void => setCohortStep(BEATS[i]);

/** How it works opens here: one bug becomes twelve attempts, and twelve become the whole study. */
export function OneBugStory({ summary }: Props) {
  const webgl = useUi((s) => s.webgl);
  const reduced = useUi((s) => s.reducedMotion);
  const wide = useMedia(WIDE);
  const use3d = webgl && wide;
  const root = useRef<HTMLElement>(null);
  const near = useInView(root, '900px');
  const stage = useRef<HTMLDivElement>(null);

  const ordered = useMemo(() => (summary ? [...summary.tasks.filter((t) => t.set === 'test'), ...summary.tasks.filter((t) => t.set === 'fresh')] : []), [summary]);
  const task = ordered.find((t) => t.id === FEATURED_TASK);

  useEffect(() => {
    if (!summary || !use3d || !near || !stage.current) return;
    cohort.tasks = ordered;
    cohort.arms = summary.arms;
    cohort.focus = Math.max(0, ordered.findIndex((t) => t.id === FEATURED_TASK));
    return scenes.request('cohort', stage.current, { reducedMotion: 'static', lowTier: false });
  }, [summary, use3d, near, ordered]);
  useEffect(() => { cohort.reduced = reduced; }, [reduced]);

  const steps: StoryStep[] = useMemo(() => !summary ? [] : [
    {
      title: 'Start with one real bug.',
      body: <p>This is <code>{task ? shortId(task.id) : 'one bug'}</code>{task ? `: ${task.title}.` : '.'} It is one of the {summary.tasks.length} real sqlglot bugs in the study, shown as an example rather than a typical case.</p>,
    },
    ...summary.arms.map((a, i) => ({
      title: i === 0 ? a.label : `Then: ${a.label}`,
      body: <p><i className="story__cond" style={condStyle(a.id)} aria-hidden="true" />{CONDITION_LINE[a.id]}</p>,
    })),
    {
      title: 'Six arms, not six stages.',
      body: <p>The conditions were introduced one at a time here so you could meet them. In the study they are parallel: every condition starts again from the same snapshot of the same bug.</p>,
    },
    {
      title: 'Every condition, twice.',
      body: <p>Each bug ran twice under each condition, so one bug gives twelve attempts. Those twelve are the study's unit of comparison.</p>,
    },
    {
      title: 'Now apply that to every bug.',
      body: <p>The same six conditions and two repeats hold for all {summary.tasks.length} bugs, so every condition is compared on exactly the same bugs. This picture shows the design, not the order the runs happened in.</p>,
    },
  ], [summary, task]);

  const labels = summary?.arms ?? [];
  if (!summary) return <section id="story" className="pub onebug" aria-busy="true" />;

  return (
    <section id="story" ref={root} className="pub onebug" aria-labelledby="story-title">
      <div className="pub-container">
        <header className="pub-head">
          <p className="pub-eyebrow">How it works</p>
          <h2 id="story-title" className="pub-title">From one bug to 924 attempts.</h2>
          <p className="onebug__skip">
            <a href="#matrix" onClick={(e) => { e.preventDefault(); jumpTo('matrix', { step: true }); }}>Skip to the full dataset</a>
          </p>
        </header>

        <StoryScroller
          label="From one bug to 924 attempts"
          steps={steps}
          sticky={wide}
          onStep={onStep}
          stage={(active) => (
            <>
              <div className="story__canvas" ref={stage} aria-hidden="true">
                {!use3d && <StoryFigure beat={BEATS[active]} summary={summary} title={steps[active].title} />}
              </div>
              <ul className="story__legend" aria-hidden="true">
                {labels.slice(0, BEATS[active].lanes).map((a) => <li key={a.id} style={condStyle(a.id)}><i />{a.label}</li>)}
              </ul>
              {FORMULA[active] && <p className="story__formula">{FORMULA[active]}</p>}
            </>
          )}
          figure={(i) => <StoryFigure beat={BEATS[i]} summary={summary} title={steps[i].title} />}
        >
          <a className="pbtn pbtn--primary" href="#conditions" onClick={(e) => { e.preventDefault(); jumpTo('conditions', { step: true }); }}>Compare all six conditions</a>
        </StoryScroller>
      </div>
    </section>
  );
}
