import { useEffect, useRef, useState } from 'react';
import { REPO_URL } from '../../data/links';
import { atlas, useAtlas } from '../../state/atlasStore';
import { Icon } from '../atlas/Icon';

/**
 * The five destinations, in page order. Each answers one question. Everything else on the page sits
 * inside one of them and keeps its own id for deep links.
 */
export const NAV_ITEMS = [
  { id: 'overview', label: 'Overview' },
  { id: 'how', label: 'How it works' },
  { id: 'findings', label: 'Findings' },
  { id: 'explore', label: 'Explore bugs' },
  { id: 'details', label: 'Research details' },
] as const;

const headerHeight = (): number => (document.querySelector('.nav') as HTMLElement | null)?.offsetHeight ?? 64;

let jumpSeq = 0;

/**
 * Scrolls to a section. `step` makes the move a Back step, so moving between destinations is browser
 * history; the entry is written first, so Back returns to where the reader was.
 */
export function jumpTo(id: string, { step = false, instant = false } = {}): void {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (step) history.pushState(null, '', `${location.pathname}${location.search}#${id}`);
  else history.replaceState(null, '', `${location.pathname}${location.search}#${id}`);
  el.scrollIntoView({ behavior: reduce || instant ? 'auto' : 'smooth', block: 'start' });
  // Content above can grow while we scroll (a bug loading in the explorer): once the scroll has stopped,
  // re-aim so the heading lands just below the sticky header. A newer jump or the reader's own input wins.
  const mine = ++jumpSeq;
  let tries = 0;
  let last = Number.NaN;
  let stopped = false;
  const stop = () => { stopped = true; for (const t of ['wheel', 'touchstart', 'keydown']) window.removeEventListener(t, stop); };
  for (const t of ['wheel', 'touchstart', 'keydown']) window.addEventListener(t, stop, { passive: true });
  const settle = () => {
    if (stopped || mine !== jumpSeq) { stop(); return; }
    if (window.scrollY !== last) { last = window.scrollY; window.setTimeout(settle, 140); return; }
    const top = el.getBoundingClientRect().top;
    const want = headerHeight() + 8;
    if (Math.abs(top - want) > 24 && tries++ < 4) {
      window.scrollTo({ top: window.scrollY + top - want, behavior: 'instant' });
      last = Number.NaN;
      window.setTimeout(settle, 250);
    } else stop();
  };
  window.setTimeout(settle, 140);
  // Move focus for keyboard and screen-reader users without scrolling again.
  const heading = el.querySelector<HTMLElement>('h1, h2');
  if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
}

/** Lands on the URL's hash after the page has data. Lazy sections may mount a moment later, so it waits for them. */
export function jumpToHash(): void {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  let frames = 0;
  const attempt = () => {
    if (document.getElementById(id)) jumpTo(id, { instant: true });
    else if (frames++ < 120) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

/** Explore is spacious and visual; Investigate is dense, with source paths and full metadata. Same data, same dark theme. */
function ViewToggle() {
  const view = useAtlas((s) => s.view);
  return (
    <div className="viewtog" role="group" aria-label="Page density">
      {(['explore', 'investigate'] as const).map((v) => (
        <button key={v} type="button" aria-pressed={view === v} onClick={() => atlas.set({ view: v }, 'push')}>{v === 'explore' ? 'Explore' : 'Investigate'}</button>
      ))}
    </div>
  );
}

function ExternalLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <button type="button" className="nav__search" onClick={() => { onNavigate?.(); atlas.set({ palette: true }, 'none'); }} aria-label="Search the study (Control K)">
        <Icon name="search" /><span>Search</span><kbd aria-hidden="true">Ctrl K</kbd>
      </button>
      <ViewToggle />
      <a className="nav__ext" href={REPO_URL} target="_blank" rel="noopener noreferrer" onClick={onNavigate}>
        GitHub<span aria-hidden="true"> ↗</span>
      </a>
      <span className="nav__status" title="All 924 runs finished. The results below are final."><i aria-hidden="true" />Study complete</span>
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

  const go = (id: string) => { setOpen(false); jumpTo(id, { step: true }); };
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
          UPLIFT <span aria-hidden="true">/</span>
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
