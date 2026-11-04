import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArmId, Summary } from '../../data/types';
import { GROUP_LABEL, groupCounts, groupOf, shortId } from '../../data/classify';
import { useMedia } from '../../hooks/useMedia';
import { scenes, useScenes, useUi } from '../../state/sceneStore';
import { atlas, closeInspector, openCondition, openTask, useAtlas } from '../../state/atlasStore';
import { lattice, latticeHandlers, latticeLabels, latticeScroll, type LatticeMode } from '../../state/latticeStore';
import { DEFAULT_VIEW, nebula, nebulaDom, useNebula, type NebulaLens } from '../../state/nebulaStore';
import { ExperimentOverview } from './ExperimentOverview';
import { NebulaMap } from './NebulaMap';
import { Icon } from '../atlas/Icon';
import { ToolButton } from '../atlas/Primitives';
import { condStyle } from '../../utils/condition';

interface Props { summary: Summary }

/** Phones get the 2D Atlas, and no three.js at all. */
const SPATIAL = '(min-width: 761px)';

const GUIDE = [
  { lens: 'explore', focus: false, title: 'One node, one bug', text: 'Each node is one of the 77 real sqlglot bugs. A node\'s position carries no meaning: nearby bugs are not related.' },
  { lens: 'outcome', focus: false, title: 'What happened to them', text: 'Green bugs were solved by every run, red by none, and amber by some. Only the amber bugs can separate the setups.' },
  { lens: 'outcome', focus: true, title: 'One bug, up close', text: 'This is the WINDOW bug, or the bug you selected. It was attempted twelve times: six conditions, two repeats each.' },
  { lens: 'condition', focus: true, title: 'Seen through one condition', text: 'Pick a condition: each node then shows how many of its two runs solved that bug under it.' },
] as const;

/**
 * The hero figure. Two views of the same study: the 77 bugs (the Nebula) and the 924 runs (the
 * Lattice), one at a time. Both draw in the one shared canvas, into `.lattice__canvas-wrap`; this
 * component requests the scene and owns every DOM control, so everything works without a pointer.
 * Phones and browsers without WebGL get the 2D versions and all the same information.
 */
export function HeroStage({ summary }: Props) {
  const webgl = useUi((s) => s.webgl);
  const reduced = useUi((s) => s.reducedMotion);
  const spatial = useMedia(SPATIAL);
  const use3d = webgl && spatial;
  const root = useRef<HTMLDivElement>(null);
  const heroMode = useAtlas((s) => s.heroMode);
  const scene = heroMode === 'bugs' ? 'nebula' : 'lattice';

  const tasks = useMemo(
    () => [...summary.tasks.filter((t) => t.set === 'test'), ...summary.tasks.filter((t) => t.set === 'fresh')],
    [summary],
  );
  const arms = summary.arms;
  const nTest = tasks.filter((t) => t.set === 'test').length;
  const repeats = Math.round(arms[0].attempts / tasks.length);
  const groups = useMemo(() => groupCounts(tasks), [tasks]);
  const agree = groups.always + groups.never;

  const [mode, setMode] = useState<LatticeMode>(reduced ? 'outcomes' : 'design');
  const [touched, setTouched] = useState(false);
  const [ready, setReady] = useState(false);
  const selected = useAtlas((s) => s.task);
  const condition = useAtlas((s) => s.condition);
  const focus = Math.max(0, tasks.findIndex((t) => t.id === selected));
  const [hovered, setHovered] = useState<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const sceneMounted = useScenes(() => scenes.get(scene).mounted);
  const lens = useNebula((s) => s.lens);
  const [guide, setGuide] = useState<number | null>(null);

  // Hand the current selection to the scene inside the shared canvas. The store is filled during
  // render as well, so a scene mounting in this same commit already sees the tasks.
  if (lattice.get().tasks !== tasks) lattice.set({ tasks, arms });
  useEffect(() => { lattice.set({ tasks, arms, mode, focus, hovered, reduced }); }, [tasks, arms, mode, focus, hovered, reduced]);
  useEffect(() => {
    latticeHandlers.onHover = setHovered;
    latticeHandlers.onPick = (i) => openTask(tasks[i].id);
    latticeHandlers.onReady = () => setReady(true);
  }, [tasks]);

  // Request the scene shown here. Only one is ever requested, so only one is mounted and drawn.
  useEffect(() => {
    if (!use3d || !stage.current) return;
    return scenes.request(scene, stage.current, { reducedMotion: 'static', lowTier: true });
  }, [use3d, scene]);

  // Once the lattice has built, the results arrive on their own (once), unless the reader has
  // already chosen a view. Both views stay one click away.
  const visible = useScenes(() => scenes.get('lattice').visible);
  useEffect(() => {
    if (!ready || touched || mode !== 'design' || !visible) return;
    const id = window.setTimeout(() => setMode('outcomes'), 1400);
    return () => window.clearTimeout(id);
  }, [ready, touched, mode, visible]);

  // Scroll progress of the hero, read by the lattice camera (no pinning, no scroll-jacking).
  useEffect(() => {
    const onScroll = () => {
      const hero = document.getElementById('overview');
      if (!hero) return;
      latticeScroll.value = Math.min(1, Math.max(0, window.scrollY / Math.max(1, hero.offsetHeight)));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const shown = hovered ?? focus;
  const t = tasks[shown];
  const choose = (m: LatticeMode) => { setTouched(true); setMode(m); };
  const step = (d: number) => { setHovered(null); atlas.set({ task: tasks[(focus + d + tasks.length) % tasks.length].id }); };
  const setLens = (l: NebulaLens) => {
    nebula.set({ lens: l });
    if (l === 'condition' && !atlas.get().condition) atlas.set({ condition: arms[0].id as ArmId });
  };
  const goGuide = (i: number | null) => {
    setGuide(i);
    if (i === null) return;
    setLens(GUIDE[i].lens);
    if (GUIDE[i].focus) nebula.set({ focusTick: nebula.get().focusTick + 1 });
  };
  const reset = () => {
    setGuide(null);
    closeInspector();
    nebula.set({ ...DEFAULT_VIEW, lens: 'explore' });
  };

  const switcher = (
    <div className="seg-dark herosw" role="group" aria-label="What the figure shows">
      <button type="button" aria-pressed={heroMode === 'bugs'} onClick={() => atlas.set({ heroMode: 'bugs' }, 'push')}>77 bugs</button>
      <button type="button" aria-pressed={heroMode === 'runs'} onClick={() => atlas.set({ heroMode: 'runs' }, 'push')}>924 runs</button>
    </div>
  );

  // No 3D here: the same two views in 2D.
  if (!use3d) {
    return (
      <div className="lattice lattice--svg">
        <div className="lattice__toolbar">{switcher}</div>
        {heroMode === 'bugs'
          ? <><NebulaMap summary={summary} /><p className="caption"><span className="caption__n">Figure 1.</span> All 77 bugs, grouped by what happened to them. Select a bug to open its record.</p></>
          : <ExperimentOverview summary={summary} />}
      </div>
    );
  }

  return (
    <figure className={`lattice is-${mode} is-${scene}`} ref={root} aria-labelledby="lattice-caption">
      <div className="lattice__stage">
        <div className="lattice__toolbar">
          {switcher}
          {heroMode === 'runs' ? (
            <div className="seg-dark" role="group" aria-label="What the lattice shows">
              <button type="button" aria-pressed={mode === 'design'} onClick={() => choose('design')}>Design</button>
              <button type="button" aria-pressed={mode === 'outcomes'} onClick={() => choose('outcomes')}>Outcomes</button>
            </div>
          ) : (
            <div className="seg-dark" role="group" aria-label="Nebula lens">
              {(['explore', 'outcome', 'condition'] as const).map((l) => (
                <button key={l} type="button" aria-pressed={lens === l} onClick={() => setLens(l)}>{l === 'explore' ? 'Explore' : l === 'outcome' ? 'Outcome' : 'Condition'}</button>
              ))}
            </div>
          )}
          <ul className="lattice__key" aria-hidden="true">
            {heroMode === 'bugs'
              ? (lens === 'explore'
                ? <><li><i className="k-node" /> One bug</li><li><i className="k-focus" /> Selected</li></>
                : <><li><i className="k-solved" /> {lens === 'outcome' ? `Always ${groups.always}` : '2 of 2'}</li><li><i className="k-mixed" /> {lens === 'outcome' ? `Mixed ${groups.mixed}` : '1 of 2'}</li><li><i className="k-failed" /> {lens === 'outcome' ? `Never ${groups.never}` : '0 of 2'}</li></>)
              : (mode === 'outcomes'
                ? <><li><i className="k-solved" /> Solved run</li><li><i className="k-failed" /> Failed run</li></>
                : <><li><i className="k-run" /> One run</li><li><i className="k-focus" /> One bug, all six conditions</li></>)}
          </ul>
        </div>

        {heroMode === 'bugs' && lens === 'condition' && (
          <div className="lens-conds" role="group" aria-label="Condition shown by the lens">
            {arms.map((a) => (
              <button key={a.id} type="button" className="lens-cond" style={condStyle(a.id)} aria-pressed={condition === a.id} onClick={() => atlas.set({ condition: a.id })}><i aria-hidden="true" />{a.label}</button>
            ))}
          </div>
        )}

        <div className="lattice__canvas-wrap" aria-hidden="true" ref={stage}>
          {!sceneMounted && <p className="lattice__loading">{heroMode === 'bugs' ? `Mapping ${tasks.length} bugs…` : `Placing ${summary.summary.runs} runs…`}</p>}
          <span className="neb-tag" ref={(el) => { nebulaDom.tag = el; }} />
          {heroMode === 'runs' && (
            <div className="lattice__labels">
              {arms.map((a, r) => (
                <span key={a.id} className="lattice__lane" style={condStyle(a.id)} ref={(el) => { latticeLabels[r] = el; }}>
                  <b>{r + 1}</b><span className="lattice__lane-name">{a.label}</span>
                </span>
              ))}
              <span className="lattice__group" ref={(el) => { latticeLabels[arms.length] = el; }}>{nTest} test bugs</span>
              <span className="lattice__group" ref={(el) => { latticeLabels[arms.length + 1] = el; }}>{tasks.length - nTest} fresh bugs</span>
              {arms.map((a, r) => (
                <span key={'back-' + a.id} className="lattice__lane lattice__lane--num" style={condStyle(a.id)} ref={(el) => { latticeLabels[arms.length + 2 + r] = el; }}>
                  <b>{r + 1}</b>
                </span>
              ))}
            </div>
          )}
        </div>

        {heroMode === 'bugs' && (
          <div className="dock" role="toolbar" aria-label="Nebula view controls">
            <ToolButton icon="rotate" aria-label="Rotate" title="Rotate" onClick={() => nebula.set({ yaw: nebula.get().yaw + Math.PI / 4 })} />
            <ToolButton icon="plus" aria-label="Zoom in" title="Zoom in" onClick={() => nebula.set({ zoom: Math.min(1.8, nebula.get().zoom + 0.2) })} />
            <ToolButton icon="minus" aria-label="Zoom out" title="Zoom out" onClick={() => nebula.set({ zoom: Math.max(0.7, nebula.get().zoom - 0.2) })} />
            <ToolButton icon="focus" aria-label="Focus the selected bug" title="Focus the selected bug" onClick={() => nebula.set({ focusTick: nebula.get().focusTick + 1 })} />
            <ToolButton icon="fit" aria-label="Fit to view" title="Fit to view" onClick={() => nebula.set({ zoom: 1 })} />
            <ToolButton icon="reset" aria-label="Reset the view" title="Reset the view" onClick={reset} />
            <ToolButton icon="play" pressed={guide !== null} onClick={() => goGuide(guide === null ? 0 : null)}>{guide === null ? 'Guided' : 'Exit guide'}</ToolButton>
          </div>
        )}
        {guide !== null && (
          <div className="neb-guide" role="status">
            <p className="kicker">Step {guide + 1} of {GUIDE.length}</p>
            <p className="neb-guide__title">{GUIDE[guide].title}</p>
            <p className="neb-guide__text">{GUIDE[guide].text}</p>
            <div className="neb-guide__nav">
              <ToolButton disabled={guide === 0} onClick={() => goGuide(guide - 1)}>Previous</ToolButton>
              {guide < GUIDE.length - 1 ? <ToolButton onClick={() => goGuide(guide + 1)}>Next</ToolButton> : <ToolButton onClick={() => goGuide(null)}>Finish</ToolButton>}
            </div>
          </div>
        )}

        <div className="lattice__readout">
          <div className="lattice__bug">
            <span className="lattice__bug-id">{shortId(t.id)}</span>
            <span className="lattice__bug-title">{t.title}</span>
            {(mode === 'outcomes' || heroMode === 'bugs') && <span className={`lattice__bug-group g-${groupOf(t.solved)}`}>{GROUP_LABEL[groupOf(t.solved)]}</span>}
          </div>
          <ol className="lattice__runs" aria-label={`Runs for ${shortId(t.id)}`}>
            {arms.map((a, r) => {
              const out = mode === 'outcomes' || heroMode === 'bugs';
              return (
                <li key={a.id}>
                  <span className="lattice__runs-n">{r + 1}</span>
                  <button type="button" className="lattice__runs-name linkish" onClick={() => openCondition(a.id)}>{a.label}</button>
                  <span className="lattice__runs-dots" aria-label={out ? `${t.solved[a.id]} of ${repeats} solved` : `${repeats} runs`}>
                    {Array.from({ length: repeats }, (_, k) => (
                      <i key={k} className={out ? (k < t.solved[a.id] ? 'd-solved' : 'd-failed') : 'd-run'} />
                    ))}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="lattice__actions">
            <button type="button" className="lattice__step" onClick={() => step(-1)} aria-label="Previous bug">←</button>
            <span className="lattice__pos">Bug {shown + 1} of {tasks.length}</span>
            <button type="button" className="lattice__step" onClick={() => step(1)} aria-label="Next bug">→</button>
            <button type="button" className="lattice__open" onClick={() => openTask(t.id)}>Open its 12 runs <Icon name="arrow" size={13} /></button>
          </div>
        </div>
      </div>

      <figcaption id="lattice-caption" className="lattice__caption">
        <span className="caption__n">Figure 1.</span>{' '}
        {heroMode === 'bugs'
          ? <>Each node is one of the {tasks.length} real bugs. A node's position carries no meaning. Hover, drag to turn, or step through the bugs; select one to open its record.</>
          : mode === 'design'
            ? <>All {summary.summary.runs} runs. Six lanes, one per condition, run through the same {tasks.length} bugs; each bug is a
              band across the lanes with one cube per repeat. Every condition is compared with No setup on exactly these bugs.</>
            : <>The same {summary.summary.runs} runs, coloured by their real result. In <strong>{agree} of {tasks.length}</strong> bugs all
              {' '}{arms.length * repeats} runs agree, so a run's outcome depended far more on the bug than on the setup. Only
              the {groups.mixed} mixed bugs can tell setups apart.</>}
        {heroMode === 'runs' && ' Hover or step through the bugs; click one to open its runs.'}
      </figcaption>
    </figure>
  );
}
