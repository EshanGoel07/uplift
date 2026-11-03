import { useRef } from 'react';
import { gsap, useGsap } from '../../hooks/useGsap';
import { live, requestFrame, ui, useUi } from '../../state/sceneStore';
import { SectionHead } from '../../components/interface/SectionHead';
import { useMedia, WIDE } from '../../hooks/useMedia';
import { STAGES } from './stages';

export function Methodology() {
  const root = useRef<HTMLElement>(null);
  const webgl = useUi((s) => s.webgl);
  const reduced = useUi((s) => s.reducedMotion);
  const stage = useUi((s) => s.pipelinePick ?? s.pipelineStage);
  const picked = useUi((s) => s.pipelinePick);
  const wide = useMedia(WIDE);
  const cinematic = webgl && !reduced && wide;

  // Pinned sequence C: the pipeline assembles and each stage activates with scroll.
  useGsap(root, () => {
    if (!webgl) return;
    const stageEl = root.current!.querySelector('.method__pin') as HTMLElement;
    // Visibility: fade in on approach, out as the section leaves.
    gsap.timeline({
      scrollTrigger: {
        trigger: stageEl, start: 'top bottom', end: 'top 20%', scrub: true,
        onUpdate: (s) => { live.pipelineVis = s.progress; requestFrame(); },
      },
    });
    if (!cinematic) { live.pipeline = 1; }
    if (cinematic) {
    gsap.timeline({
      scrollTrigger: {
        trigger: stageEl, start: 'top top', end: '+=260%', pin: true, scrub: 0.5,
        onUpdate: (s) => {
          live.pipeline = s.progress;
          const idx = Math.min(STAGES.length - 1, Math.floor(s.progress * STAGES.length * 1.12));
          ui.set({ pipelineStage: idx, pipelinePick: null });
          requestFrame();
        },
      },
    });
    }
    // Leave: fade the 3D out as the stage's bottom scrolls past (after the pin, if any).
    gsap.timeline({
      scrollTrigger: {
        trigger: stageEl, start: 'bottom 70%', end: 'bottom 10%', scrub: true,
        onUpdate: (s) => { live.pipelineOut = s.progress; requestFrame(); },
      },
    });
  }, [webgl, cinematic]);

  const current = STAGES[stage];

  return (
    <section id="method" ref={root} className="section method-section" aria-labelledby="method-title">
      <div className="container">
        <SectionHead index="05" eyebrow="Method" id="method-title" title="Five stages, from git history to a graded run."
          lead="The method is repo-independent: point it at a repository's own past bugs. Each stage below is real code in the Uplift repo." />
      </div>

      <div className={`method__pin${webgl ? ' has-3d' : ''}`}>
        <div className="method__layout container">
          <div className="method__panel">
            <ol className="stage-list" aria-label="Pipeline stages">
              {STAGES.map((s, i) => (
                <li key={s.n}>
                  <button type="button" className={`stage-btn${i === stage ? ' is-active' : ''}${i < stage ? ' is-done' : ''}`}
                          aria-current={i === stage ? 'step' : undefined}
                          onClick={() => { ui.set({ pipelinePick: i }); requestFrame(); }}>
                    <span className="stage-btn__n mono">{s.n}</span>
                    <span className="stage-btn__title">{s.title}</span>
                    <span className="stage-btn__short">{s.short}</span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="stage-detail" aria-live="polite">
              <p className="label label--ember">Stage {current.n}{picked !== null ? ' · selected' : ''}</p>
              <h3>{current.title}</h3>
              <p>{current.body}</p>
              <ul className="stage-detail__facts">{current.facts.map((f) => <li key={f}>{f}</li>)}</ul>
              <p className="stage-detail__cmd mono"><span aria-hidden="true">$ </span>{current.command}</p>
            </div>
          </div>
          <div className="method__stage" aria-hidden={!webgl}>
            {webgl && <p className="visually-hidden">3D diagram of the five pipeline stages; the list beside it holds the same content.</p>}
            {webgl && <p className="method__hint label">{cinematic ? 'Scroll to run the pipeline · click a module' : 'Tap a stage or a module to highlight it'}</p>}
          </div>
        </div>
      </div>

      {/* The full readable method, independent of the 3D pipeline */}
      <div className="container">
        <ol className="method-steps">
          {STAGES.map((s) => (
            <li key={s.n} className="method-step">
              <span className="method-step__n mono">{s.n}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
