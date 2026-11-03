import { useEffect, useRef, useState } from 'react';

export const NAV_ITEMS = [
  { id: 'overview', label: 'Overview' },
  { id: 'results', label: 'Results' },
  { id: 'matrix', label: 'Bug matrix' },
  { id: 'explorer', label: 'Explorer' },
  { id: 'trust', label: 'Trust' },
  { id: 'method', label: 'Method' },
] as const;

export function jumpTo(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  history.replaceState(null, '', `#${id}`);
  // Content above can grow while we scroll (a bug loading in the explorer): re-aim once it settles.
  const navH = (document.querySelector('.nav') as HTMLElement | null)?.offsetHeight ?? 60;
  let tries = 0;
  const settle = () => {
    const top = el.getBoundingClientRect().top;
    if (Math.abs(top - navH - 8) > 24 && tries++ < 4) {
      window.scrollTo({ top: window.scrollY + top - navH - 8, behavior: 'auto' });
      window.setTimeout(settle, 250);
    }
  };
  window.setTimeout(settle, reduce ? 50 : 700);
  // Move focus for keyboard and screen-reader users without scrolling again.
  const heading = el.querySelector<HTMLElement>('h1, h2');
  if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
}

export function Nav() {
  const [active, setActive] = useState<string>('overview');
  const bar = useRef<HTMLDivElement>(null);

  // Scroll-spy: the section crossing the upper third of the viewport is current.
  useEffect(() => {
    const ids = NAV_ITEMS.map((n) => n.id);
    const onScroll = () => {
      const line = window.innerHeight * 0.33;
      let current = ids[0] as string;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      setActive((a) => (a === current ? a : current));
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (bar.current) bar.current.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);

  return (
    <header className="nav">
      <div className="nav__inner">
        <a className="nav__brand" href="#overview" onClick={(e) => { e.preventDefault(); jumpTo('overview'); }} aria-label="Uplift, back to the top">
          UPLIFT<span className="nav__caret">_</span>
        </a>
        <nav aria-label="Sections">
          <ul className="nav__links">
            {NAV_ITEMS.map((n) => (
              <li key={n.id}>
                <a href={`#${n.id}`} aria-current={active === n.id ? 'location' : undefined}
                   onClick={(e) => { e.preventDefault(); jumpTo(n.id); }}>{n.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <a className="nav__data" href="./data/results.json" download>Raw data</a>
      </div>
      <div className="nav__progress" aria-hidden="true"><div ref={bar} className="nav__progress-bar" /></div>
    </header>
  );
}

export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > window.innerHeight * 1.5);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <button type="button" className={`to-top${show ? ' is-visible' : ''}`} onClick={() => jumpTo('overview')}
            aria-label="Back to top" tabIndex={show ? 0 : -1} aria-hidden={!show}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}
