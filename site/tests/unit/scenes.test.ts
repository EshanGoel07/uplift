// @vitest-environment jsdom
// The scene registry and the one-canvas architecture: lifecycle, render wake-ups and cleanup.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const src = resolve(__dirname, '../../src');
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : []));

/** A stage element at a chosen viewport position (jsdom has no layout). */
function stageAt(top: number, height = 400): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ top, bottom: top + height, left: 0, right: 800, width: 800, height, x: 0, y: top, toJSON: () => ({}) });
  return el;
}

type Store = typeof import('../../src/state/sceneStore');
let S: Store;
let frames: ReturnType<typeof vi.fn<() => void>>;
let rafQueue: Map<number, FrameRequestCallback>;
const releases: (() => void)[] = [];
const flushRaf = () => { const q = [...rafQueue.values()]; rafQueue.clear(); q.forEach((f) => f(0)); };

beforeEach(async () => {
  vi.resetModules();
  rafQueue = new Map();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { rafQueue.set(++id, f); return id; });
  vi.stubGlobal('cancelAnimationFrame', (n: number) => { rafQueue.delete(n); });
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
  S = await import('../../src/state/sceneStore');
  frames = vi.fn<() => void>();
  S.setInvalidator(frames);
  // Every module instance attaches real window listeners: release whatever a test left requested.
  const request = S.scenes.request;
  S.scenes.request = (...a) => { const r = request(...a); releases.push(r); return r; };
});
afterEach(() => { releases.splice(0).forEach((r) => r()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('scene lifecycle', () => {
  it('moves through requested, mounted, visible states and is disposed on release', () => {
    expect(S.scenes.phase('lattice')).toBe('available');
    const release = S.scenes.request('lattice', stageAt(100));
    expect(S.scenes.phase('lattice')).toBe('requested');
    S.scenes.setMounted('lattice', true);
    expect(S.scenes.phase('lattice')).toBe('active');
    S.scenes.animate('lattice');
    expect(S.scenes.phase('lattice')).toBe('animating');
    S.scenes.settle('lattice');
    expect(S.scenes.phase('lattice')).toBe('active');
    S.scenes.setMounted('lattice', false);
    release();
    expect(S.scenes.phase('lattice')).toBe('disposed');
    expect(S.scenes.get('lattice')).toMatchObject({ mounts: 1, disposals: 1, requested: false, visible: false, stage: null });
  });

  it('a mounted scene off screen is not visible, and mounted does not mean rendering', () => {
    S.scenes.request('workbench', stageAt(5000));
    S.scenes.setMounted('workbench', true);
    expect(S.scenes.phase('workbench')).toBe('mounted');
    expect(S.scenes.isVisible('workbench')).toBe(false);
    expect(S.live.workbenchVis).toBe(0);
    expect(S.ui.get().activeScene).toBeNull();
  });

  it('reports the most visible scene and keeps live.workbenchVis in step', () => {
    S.scenes.request('lattice', stageAt(600));      // 168 of 400 px on a 768 px viewport
    S.scenes.request('workbench', stageAt(100));    // fully on screen
    expect(S.ui.get().activeScene).toBe('workbench');
    expect(S.live.workbenchVis).toBe(1);
  });

  it('a released scene cannot be disturbed by a second release', () => {
    const release = S.scenes.request('lattice', stageAt(0));
    const again = S.scenes.request('workbench', stageAt(0));
    release(); release();
    expect(S.scenes.get('workbench').requested).toBe(true);
    again();
  });
});

describe('render wake-ups', () => {
  it('scrolling wakes the renderer only while a scene is visible', () => {
    S.scenes.request('workbench', stageAt(5000));
    frames.mockClear();
    window.dispatchEvent(new Event('scroll'));
    flushRaf();
    expect(frames).not.toHaveBeenCalled();
  });

  it('a visible scene gets one wake-up per scroll event, inside the event', () => {
    S.scenes.request('lattice', stageAt(0));
    frames.mockClear();
    window.dispatchEvent(new Event('scroll'));
    expect(frames).toHaveBeenCalledTimes(1);
    flushRaf();
    expect(frames).toHaveBeenCalledTimes(1);
  });

  it('a visibility flip gets exactly one clearing frame', () => {
    const el = stageAt(0);
    S.scenes.request('lattice', el);
    frames.mockClear();
    el.getBoundingClientRect = stageAt(5000).getBoundingClientRect;
    window.dispatchEvent(new Event('scroll'));
    flushRaf();
    expect(S.scenes.isVisible('lattice')).toBe(false);
    const after = frames.mock.calls.length;
    expect(after).toBeLessThanOrEqual(2);       // the scroll that moved it, plus the clearing frame
    window.dispatchEvent(new Event('scroll'));
    flushRaf();
    expect(frames.mock.calls.length).toBe(after);
  });

  it('many scroll events in one frame schedule a single measurement', () => {
    S.scenes.request('lattice', stageAt(0));
    rafQueue.clear();
    for (let i = 0; i < 20; i++) window.dispatchEvent(new Event('scroll'));
    expect(rafQueue.size).toBe(1);
  });

  it('an animation asks for frames only while it runs', () => {
    S.scenes.request('lattice', stageAt(0));
    frames.mockClear();
    S.scenes.animate('lattice'); S.scenes.animate('lattice');
    expect(frames).toHaveBeenCalledTimes(2);
    expect(S.invalidations.animation).toBe(2);
    S.scenes.settle('lattice');
    expect(S.scenes.get('lattice').animating).toBe(false);
    expect(frames).toHaveBeenCalledTimes(2);
  });
});

describe('cleanup', () => {
  it('attaches one scroll and resize listener however many scenes exist, and removes them with the last', () => {
    const add = vi.spyOn(window, 'addEventListener'), rem = vi.spyOn(window, 'removeEventListener');
    const a = S.scenes.request('lattice', stageAt(0));
    const b = S.scenes.request('workbench', stageAt(0));
    const added = add.mock.calls.filter(([t]) => t === 'scroll' || t === 'resize');
    expect(added).toHaveLength(2);
    a();
    expect(rem.mock.calls.filter(([t]) => t === 'scroll')).toHaveLength(0);
    b();
    const removed = rem.mock.calls.filter(([t]) => t === 'scroll' || t === 'resize');
    expect(removed).toHaveLength(2);
    // Removed with the same listener identity that was added.
    for (const [t, fn] of added) expect(removed.some(([rt, rf]) => rt === t && rf === fn)).toBe(true);
    expect(S.scenes._listening().attached).toBe(false);
  });

  it('a pending measurement frame is cancelled on the last release', () => {
    const release = S.scenes.request('lattice', stageAt(0));
    window.dispatchEvent(new Event('scroll'));
    expect(S.scenes._listening().pending).toBe(true);
    release();
    expect(S.scenes._listening().pending).toBe(false);
    expect(rafQueue.size).toBe(0);
  });
});

describe('useNear', () => {
  let root: Root, host: HTMLElement;
  const mount = async (selector: string) => {
    const { useNear } = await import('../../src/hooks/useNear');
    const seen: boolean[] = [];
    const C = () => { seen.push(useNear(selector, '0px')); return null; };
    host = document.createElement('div');
    root = createRoot(host);
    await act(async () => { root.render(createElement(C)); });
    return seen;
  };
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

  it('keeps one retry pending while the element is missing, and cancels it on unmount', async () => {
    await mount('#not-yet');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(vi.getTimerCount()).toBe(1);      // retries do not accumulate
    await act(async () => { root.unmount(); });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a late observer callback after unmount cannot update state', async () => {
    let fire: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class { constructor(cb: IntersectionObserverCallback) { fire = cb; } observe() {} disconnect = disconnect; });
    const el = document.createElement('div'); el.id = 'there'; document.body.append(el);
    const seen = await mount('#there');
    await act(async () => { root.unmount(); });
    expect(disconnect).toHaveBeenCalled();
    const renders = seen.length;
    fire([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(seen.length).toBe(renders);
  });

  it('becomes true when the element approaches', async () => {
    let fire: IntersectionObserverCallback = () => {};
    vi.stubGlobal('IntersectionObserver', class { constructor(cb: IntersectionObserverCallback) { fire = cb; } observe() {} disconnect() {} });
    const el = document.createElement('div'); el.id = 'soon'; document.body.append(el);
    const seen = await mount('#soon');
    await act(async () => { fire([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); });
    expect(seen.at(-1)).toBe(true);
    await act(async () => { root.unmount(); });
  });
});

describe('one-canvas architecture (source guards)', () => {
  const all = files(src).map((f) => ({ f, s: readFileSync(f, 'utf-8') }));
  const rel = (f: string) => f.replace(/\\/g, '/').split('/src/')[1];
  it('Workbench-only code sits behind the one lazy boundary', () => {
    expect(all.filter(({ s }) => /@react-three\/postprocessing/.test(s)).map(({ f }) => rel(f))).toEqual(['scenes/Workbench/WorkbenchLayer.tsx']);
    expect(all.filter(({ s }) => /from '.*WorkbenchScene'/.test(s)).map(({ f }) => rel(f))).toEqual(['scenes/Workbench/WorkbenchLayer.tsx']);
    expect(all.filter(({ s }) => /^import .*WorkbenchLayer/m.test(s)).map(({ f }) => rel(f))).toEqual([]);
  });
  it('the lattice writes no instance buffer after its build-in: hover and focus are uniforms', () => {
    const s = readFileSync(join(src, 'scenes/RunLattice/RunLattice.tsx'), 'utf-8');
    expect(s).not.toMatch(/addUpdateRange/);
    expect(s).toMatch(/uniform float uLift/);
  });
  it('only ExperienceCanvas creates a <Canvas>', () => {
    expect(all.filter(({ s }) => /<Canvas\b/.test(s)).map(({ f }) => f.replace(/\\/g, '/').split('/src/')[1])).toEqual(['scenes/ExperienceCanvas.tsx']);
  });
  it('the frameloop is demand-driven: no continuous mode anywhere', () => {
    const bad = all.filter(({ s }) => /frameloop=.*always/.test(s)).map(({ f }) => f);
    expect(bad).toEqual([]);
  });
  it('scene files own no scroll listener: the registry is the single measurement loop', () => {
    const bad = all.filter(({ f, s }) => /[\\/]scenes[\\/]/.test(f) && /addEventListener\('scroll'/.test(s)).map(({ f }) => f);
    expect(bad).toEqual([]);
  });
});
