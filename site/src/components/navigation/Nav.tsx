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

const PLACE_KEY = 'uplift:place';
interface Place { story?: string; step?: number; section?: string; offset?: number }

/** What the reader was on, not a pixel: the page's height changes as data and sections arrive. */
function currentPlace(): Place {
  for (const story of document.querySelectorAll<HTMLElement>('.story--sticky')) {
    const stage = story.querySelector('.story__stage')?.getBoundingClientRect();
    const step = story.querySelector<HTMLElement>('.story__step.is-active');
    const owner = story.closest('section')?.id;
    if (owner && step && stage && stage.top < window.innerHeight / 2 && stage.bottom > window.innerHeight / 2) return { story: owner, step: +step.dataset.step! };
  }
  const sections = [...document.querySelectorAll<HTMLElement>('main section[id]')];
  const at = sections.find((s) => s.getBoundingClientRect().bottom > 0);
  return at ? { section: at.id, offset: Math.round(-at.getBoundingClientRect().top) } : {};
}

function placeTarget(p: Place): { el: Element; block: ScrollLogicalPosition; offset: number } | null {
  const el = p.step !== undefined ? document.querySelector(`#${p.story} .story__step[data-step="${p.step}"]`) : p.section ? document.getElementById(p.section) : null;
  return el ? { el, block: p.step !== undefined ? 'center' : 'start', offset: p.offset ?? 0 } : null;
}

/** Holds the reader on their place until the layout has stopped moving under it. */
function restorePlace(p: Place): void {
  history.scrollRestoration = 'manual';
  let frames = 0, still = 0, last = Number.NaN;
  const hold = () => {
    const t = placeTarget(p);
    if (t) {
      const top = t.el.getBoundingClientRect().top;
      t.el.scrollIntoView({ behavior: 'instant', block: t.block });
      if (t.offset) window.scrollBy({ top: t.offset, behavior: 'instant' });
      const now = Math.round(window.scrollY + top);
      still = now === last ? still + 1 : 0;
      last = now;
    }
    if (still < 5 && frames++ < 240) requestAnimationFrame(hold);
    else history.scrollRestoration = 'auto';
  };
  const stop = () => { frames = 1e6; for (const e of ['wheel', 'touchstart', 'keydown']) window.removeEventListener(e, stop); };
  for (const e of ['wheel', 'touchstart', 'keydown']) window.addEventListener(e, stop, { passive: true });
  requestAnimationFrame(hold);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    try { sessionStorage.setItem(PLACE_KEY, JSON.stringify(currentPlace())); } catch { /* private mode: the browser's own restore applies */ }
  });
}

/**
 * Puts the reader in the right place once the page has data. A refresh returns them to what they were on.
 * A first arrival lands on the URL's hash; lazy sections may mount a moment later, so it waits for them.
 */
export function jumpToHash(): void {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav?.type === 'reload') {
    let saved: Place | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(PLACE_KEY) ?? 'null') as Place | null; } catch { saved = null; }
    if (saved && (saved.step !== undefined || saved.section)) restorePlace(saved);
    return;
  }
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id || nav?.type === 'back_forward') return;
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
      <Icon name="up" size={16} />
    </button>
  );
}
