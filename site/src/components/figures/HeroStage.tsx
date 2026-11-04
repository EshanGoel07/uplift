import { useEffect, useMemo, useRef, useState } from 'react';
import type { Summary } from '../../data/types';
import { GROUP_LABEL, groupCounts, groupOf, shortId } from '../../data/classify';
import { FEATURED_TASK } from '../../data/reportFigures';
import { scenes, useScenes, useUi } from '../../state/sceneStore';
import { lattice, latticeHandlers, latticeLabels, latticeScroll, type LatticeMode } from '../../state/latticeStore';
import { useInView } from '../../hooks/useInView';
import { ExperimentOverview } from './ExperimentOverview';
import { condStyle } from '../../utils/condition';

interface Props { summary: Summary; onOpenTask: (id: string) => void }

/**
 * Figure 1 in the hero: all 924 runs as a 3D lattice (six condition lanes through 77 bugs), first as
 * the paired design, then coloured by each run's real result. The readout and the stepper give the
 * same information without a pointer; the SVG figure replaces it when WebGL is unavailable or fails.
 *
 * The lattice itself is drawn by the one shared canvas (scenes/ExperienceCanvas.tsx) into the
 * `.lattice__canvas-wrap` stage: this component requests the scene and owns every DOM control.
 */
export function HeroStage({ summary, onOpenTask }: Props) {
  const webgl = useUi((s) => s.webgl);
  const reduced = useUi((s) => s.reducedMotion);
  const root = useRef<HTMLDivElement>(null);
  const visible = useInView(root, '0px', false);

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
  const [focus, setFocus] = useState(() => Math.max(0, tasks.findIndex((t) => t.id === FEATURED_TASK)));
  const [hovered, setHovered] = useState<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const sceneMounted = useScenes(() => scenes.get('lattice').mounted);

  // Hand the current selection to the scene inside the shared canvas.
  useEffect(() => { lattice.set({ tasks, arms, mode, focus, hovered, reduced }); }, [tasks, arms, mode, focus, hovered, reduced]);
  useEffect(() => {
    latticeHandlers.onHover = setHovered;
    latticeHandlers.onPick = (i) => onOpenTask(tasks[i].id);
    latticeHandlers.onReady = () => setReady(true);
  }, [tasks, onOpenTask]);

  // Request the scene for this stage while it exists (the SVG path has no stage).
  useEffect(() => {
    if (!webgl || !stage.current) return;
    return scenes.request('lattice', stage.current, { reducedMotion: 'static', lowTier: true });
  }, [webgl]);

  // Once the lattice has built, the results arrive on their own (once), unless the reader has
  // already chosen a view. Both views stay one click away.
  useEffect(() => {
    if (!ready || touched || mode !== 'design' || !visible) return;
    const id = window.setTimeout(() => setMode('outcomes'), 1400);
    return () => window.clearTimeout(id);
  }, [ready, touched, mode, visible]);

  // Scroll progress of the hero, read by the camera (no pinning, no scroll-jacking).
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
  const step = (d: number) => { setHovered(null); setFocus((f) => (f + d + tasks.length) % tasks.length); };

  const svg = <ExperimentOverview summary={summary} />;
  if (!webgl) return <div className="lattice lattice--svg">{svg}</div>;

  return (
    <figure className={`lattice is-${mode}`} ref={root} aria-labelledby="lattice-caption">
      <div className="lattice__stage">
        <div className="lattice__toolbar">
          <div className="seg-dark" role="group" aria-label="What the lattice shows">
            <button type="button" aria-pressed={mode === 'design'} onClick={() => choose('design')}>Design</button>
            <button type="button" aria-pressed={mode === 'outcomes'} onClick={() => choose('outcomes')}>Outcomes</button>
          </div>
          <ul className="lattice__key" aria-hidden="true">
            {mode === 'outcomes'
              ? <><li><i className="k-solved" /> Solved run</li><li><i className="k-failed" /> Failed run</li></>
              : <><li><i className="k-run" /> One run</li><li><i className="k-focus" /> One bug, all six conditions</li></>}
          </ul>
        </div>

        <div className="lattice__canvas-wrap" aria-hidden="true" ref={stage}>
          {!sceneMounted && <p className="lattice__loading">Placing {summary.summary.runs} runs…</p>}
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
        </div>

        <div className="lattice__readout">
          <div className="lattice__bug">
            <span className="lattice__bug-id">{shortId(t.id)}</span>
            <span className="lattice__bug-title">{t.title}</span>
            {mode === 'outcomes' && <span className={`lattice__bug-group g-${groupOf(t.solved)}`}>{GROUP_LABEL[groupOf(t.solved)]}</span>}
          </div>
          <ol className="lattice__runs" aria-label={`Runs for ${shortId(t.id)}`}>
            {arms.map((a, r) => (
              <li key={a.id}>
                <span className="lattice__runs-n">{r + 1}</span>
                <span className="lattice__runs-name">{a.label}</span>
                <span className="lattice__runs-dots" aria-label={mode === 'outcomes' ? `${t.solved[a.id]} of ${repeats} solved` : `${repeats} runs`}>
                  {Array.from({ length: repeats }, (_, k) => (
                    <i key={k} className={mode === 'outcomes' ? (k < t.solved[a.id] ? 'd-solved' : 'd-failed') : 'd-run'} />
                  ))}
                </span>
              </li>
            ))}
          </ol>
          <div className="lattice__actions">
            <button type="button" className="lattice__step" onClick={() => step(-1)} aria-label="Previous bug">←</button>
            <span className="lattice__pos">Bug {shown + 1} of {tasks.length}</span>
            <button type="button" className="lattice__step" onClick={() => step(1)} aria-label="Next bug">→</button>
            <button type="button" className="lattice__open" onClick={() => onOpenTask(t.id)}>Open its 12 runs</button>
          </div>
        </div>
      </div>

      <figcaption id="lattice-caption" className="lattice__caption">
        <span className="caption__n">Figure 1.</span>{' '}
        {mode === 'design'
          ? <>All {summary.summary.runs} runs. Six lanes, one per condition, run through the same {tasks.length} bugs; each bug is a
            band across the lanes with one cube per repeat. Every condition is compared with No setup on exactly these bugs.</>
          : <>The same {summary.summary.runs} runs, coloured by their real result. In <strong>{agree} of {tasks.length}</strong> bugs all
            {' '}{arms.length * repeats} runs agree, so a run's outcome depended far more on the bug than on the setup. Only
            the {groups.mixed} mixed bugs can tell setups apart.</>}
        {' '}Hover or step through the bugs; click one to open its runs.
      </figcaption>
    </figure>
  );
}
