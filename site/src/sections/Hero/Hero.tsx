import { useRef } from 'react';
import type { Summary } from '../../data/types';
import { int, usd } from '../../data/format';
import { gsap, useGsap } from '../../hooks/useGsap';
import { live, requestFrame, ui, useUi } from '../../state/sceneStore';
import { jumpTo } from '../../components/navigation/Nav';
import { useMedia, WIDE } from '../../hooks/useMedia';
import { heroHotspots } from '../../scenes/SignalField/hotspots';

const BASE = import.meta.env.BASE_URL;

export function Hero({ summary }: { summary: Summary | null }) {
  const root = useRef<HTMLElement>(null);
  const webgl = useUi((s) => s.webgl);
  const reduced = useUi((s) => s.reducedMotion);
  const hotspot = useUi((s) => s.hotspot);
  const wide = useMedia(WIDE);
  // The pinned split into six streams is a desktop sequence; small screens get a still, readable hero.
  const cinematic = webgl && !reduced && wide;

  // Pinned sequence A: the field deforms, then splits into the six experiment streams.
  useGsap(root, () => {
    if (!cinematic || !summary) return;
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: '.hero__pin',
        start: 'top top',
        end: '+=140%',
        pin: true,
        scrub: 0.6,
        onUpdate: (self) => { live.hero = self.progress; requestFrame(); },
      },
    });
    tl.to('.hero__content', { opacity: 0, y: -48, duration: 0.3 }, 0.22)
      .to('.hero__cue', { opacity: 0, duration: 0.1 }, 0.05)
      .fromTo('.hero__streams', { opacity: 0 }, { opacity: 1, duration: 0.25 }, 0.62)
      .fromTo('.hero__stream', { x: 24, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.03, duration: 0.15 }, 0.66)
      .to({}, { duration: 0.12 });
  }, [cinematic, !!summary]);

  // Without the pin the streams never show.
  if (!cinematic) live.hero = 0;

  // The scene fades out as the results section comes in (pinned or not).
  useGsap(root, () => {
    const results = document.getElementById('results');
    if (!webgl || !results) return;
    gsap.timeline({
      scrollTrigger: {
        trigger: results,
        start: 'top bottom',
        end: 'top 25%',
        scrub: true,
        onUpdate: (self) => { live.heroOut = self.progress; requestFrame(); },
      },
    });
  }, [webgl, !!summary]);

  const s = summary?.summary;
  const stats = [
    { value: s ? int(s.runs) : '924', label: 'Agent runs' },
    { value: s ? int(s.tasks) : '77', label: 'Real bugs' },
    { value: summary ? String(summary.arms.length) : '6', label: 'Setups' },
    { value: s ? usd(s.total_cost_usd, 2) : '$21.31', label: 'Total cost' },
  ];
  const spots = heroHotspots(summary);
  const open = hotspot !== null ? spots[hotspot] : null;

  return (
    <section id="overview" ref={root} className="hero" aria-labelledby="hero-title">
      <div className="hero__pin">
        <div className="hero__grid container">
          <div className="hero__content">
            <div className="hero__kicker">
              <p className="hero__brand">UPLIFT<span className="nav__caret">_</span></p>
              <p className="label hero__eyebrow">Coding-agent setup study · {s?.repo ?? 'tobymao/sqlglot'}</p>
            </div>
            <h1 id="hero-title" className="hero__title">Does your coding-agent setup actually help on <em>your</em> codebase?</h1>
            <p className="hero__lead">
              We ran Muse Code {s ? int(s.runs) : '924'} times on {s ? s.tasks : 77} real sqlglot bugs.{' '}
              <strong>No setup was shown to differ from no setup</strong>, and here's how we know.
            </p>
            <dl className="hero__stats">
              {stats.map((x) => (
                <div className="stat" key={x.label}>
                  <dt className="label">{x.label}</dt>
                  <dd className="stat__num mono">{x.value}</dd>
                </div>
              ))}
            </dl>
            <ul className="hero__models" aria-label="Meta models used">
              <li><span className="model-dot" aria-hidden="true" /><strong>Muse Code</strong> agent under test</li>
              <li><span className="model-dot model-dot--alt" aria-hidden="true" /><strong>Muse Spark</strong> setup generator, tuner and failure labeller</li>
            </ul>
            <p className="hero__meta label">Meta Global AI Developer Hackathon · Indie track · Push the Frontier</p>
            <div className="hero__actions">
              <a className="btn btn--ember" href="#results" onClick={(e) => { e.preventDefault(); jumpTo('results'); }}>
                Explore the experiment
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </a>
              <a className="btn btn--ghost" href="#explorer" onClick={(e) => { e.preventDefault(); jumpTo('explorer'); }}>Open a bug</a>
            </div>
          </div>

          <div className="hero__stage">
            {!webgl && (
              <img className="hero__poster" src={`${BASE}assets/signal-field-fallback.jpg`} width="867" height="900"
                   alt="The Uplift Signal Field: layered wireframe membranes in cyan, blue, violet and magenta around a warm glowing core."
                   onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
            )}
            {webgl && (
              <p className="visually-hidden">
                Decorative 3D scene: the Uplift Signal Field, layered spectral membranes around a warm core, with four counters:
                {spots.map((h) => ` ${h.value} ${h.label}.`)}
              </p>
            )}
            {!webgl && (
              <ul className="hero__fallback-spots" aria-label="Study at a glance">
                {spots.map((h) => <li key={h.label}><span className="mono">{h.value}</span> {h.label}</li>)}
              </ul>
            )}
            {open && (
              <div className="hotspot-card" role="dialog" aria-label={`${open.value} ${open.label}`}>
                <div className="hotspot-card__head">
                  <span className="mono hotspot-card__value">{open.value}</span>
                  <span className="label">{open.label}</span>
                  <button type="button" className="icon-btn" aria-label="Close" onClick={() => ui.set({ hotspot: null })}>×</button>
                </div>
                <p>{open.detail}</p>
              </div>
            )}
          </div>
        </div>

        {cinematic && summary && (
          <div className="hero__streams" aria-hidden="true">
            <p className="label hero__streams-title">Six setups · {summary.arms[0].attempts} runs each</p>
            <ol>
              {summary.arms.map((a, i) => (
                <li key={a.id} className="hero__stream" data-stream={i}>
                  <span className="hero__stream-anchor" id={`stream-anchor-${i}`} />
                  <span>{a.label}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <button type="button" className="hero__cue" onClick={() => jumpTo('results')} aria-label="Scroll to the results">
          <span className="label">Scroll</span>
          <span className="hero__cue-line" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
