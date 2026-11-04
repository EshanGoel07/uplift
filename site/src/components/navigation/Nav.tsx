import { useEffect, useRef, useState } from 'react';
import { DEMO_VIDEO_URL, REPO_URL } from '../../data/links';

/** Section order on the page. Labels are the reader's words; ids stay stable for links and tests. */
export const NAV_ITEMS = [
  { id: 'overview', label: 'Overview' },
  { id: 'results', label: 'Findings' },
  { id: 'method', label: 'Experiment' },
  { id: 'explorer', label: 'Worked example' },
  { id: 'matrix', label: 'Explore runs' },
  { id: 'trust', label: 'Integrity' },
  { id: 'limitations', label: 'Limitations' },
] as const;

const headerHeight = (): number => (document.querySelector('.nav') as HTMLElement | null)?.offsetHeight ?? 64;

export function jumpTo(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  history.replaceState(null, '', `#${id}`);
  // Content above can grow while we scroll (a bug loading in the explorer): re-aim once it settles,
  // so the heading always lands just below the sticky header.
  let tries = 0;
  const settle = () => {
    const top = el.getBoundingClientRect().top;
    const want = headerHeight() + 8;
    if (Math.abs(top - want) > 24 && tries++ < 4) {
      window.scrollTo({ top: window.scrollY + top - want, behavior: 'auto' });
      window.setTimeout(settle, 250);
    }
  };
  window.setTimeout(settle, reduce ? 50 : 700);
  // Move focus for keyboard and screen-reader users without scrolling again.
  const heading = el.querySelector<HTMLElement>('h1, h2');
  if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
}

function ExternalLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <a className="nav__ext" href={REPO_URL} target="_blank" rel="noopener noreferrer" onClick={onNavigate}>
        GitHub<span aria-hidden="true"> ↗</span>
      </a>
      {DEMO_VIDEO_URL
        ? <a className="nav__ext" href={DEMO_VIDEO_URL} target="_blank" rel="noopener noreferrer" onClick={onNavigate}>Demo video<span aria-hidden="true"> ↗</span></a>
        : <span className="nav__ext nav__ext--pending" title="The demo video is not published yet">Demo video <span className="nav__soon">soon</span></span>}
    </>
  );
}

export function Nav() {
  const [active, setActive] = useState<string>('overview');
  const [open, setOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);

  // Scroll-spy: the last section (in page order) whose top has passed the upper third is current.
  useEffect(() => {
    const onScroll = () => {
      const line = window.innerHeight * 0.33;
      let current: string = NAV_ITEMS[0].id;
      for (const { id } of NAV_ITEMS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      setActive((a) => (a === current ? a : current));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);

  // The small-screen menu closes on Escape (returning focus to its button) and when the layout widens.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); menuBtn.current?.focus(); } };
    const wide = window.matchMedia('(min-width: 1061px)');
    const onWide = () => { if (wide.matches) setOpen(false); };
    document.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => { document.removeEventListener('keydown', onKey); wide.removeEventListener('change', onWide); };
  }, [open]);

  const go = (id: string) => { setOpen(false); jumpTo(id); };
  const links = (cls: string) => (
    <ul className={cls}>
      {NAV_ITEMS.map((n) => (
        <li key={n.id}>
          <a href={`#${n.id}`} aria-current={active === n.id ? 'location' : undefined}
             onClick={(e) => { e.preventDefault(); go(n.id); }}>{n.label}</a>
        </li>
      ))}
    </ul>
  );

  return (
    <header className={`nav${open ? ' is-open' : ''}`}>
      <div className="nav__inner">
        <a className="nav__brand" href="#overview" onClick={(e) => { e.preventDefault(); go('overview'); }} aria-label="Uplift, back to the top">
          Uplift
        </a>
        <nav className="nav__primary" aria-label="Sections">{links('nav__links')}</nav>
        <div className="nav__externals"><ExternalLinks /></div>
        <button ref={menuBtn} type="button" className="nav__menu-btn" aria-expanded={open} aria-controls="nav-menu"
                onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Menu'}
        </button>
      </div>
      <div id="nav-menu" className="nav__menu" hidden={!open}>
        <nav aria-label="Sections (menu)">{links('nav__menu-links')}</nav>
        <div className="nav__menu-ext"><ExternalLinks onNavigate={() => setOpen(false)} /></div>
      </div>
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
