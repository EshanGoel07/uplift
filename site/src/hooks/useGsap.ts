import { useLayoutEffect, type DependencyList, type RefObject } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);
export { gsap, ScrollTrigger };

/** Runs GSAP setup inside a context scoped to `scope`, and reverts every tween and trigger on cleanup. */
export function useGsap(scope: RefObject<HTMLElement | null>, setup: (ctx: gsap.Context) => void, deps: DependencyList): void {
  useLayoutEffect(() => {
    if (!scope.current) return;
    const ctx = gsap.context((self) => setup(self), scope.current);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Refresh trigger positions once layout settles (fonts, data, images). Debounced. */
let refreshTimer: number | undefined;
export function scheduleRefresh(delay = 120): void {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    // Pins are created at different times (some wait for data); refresh in page order.
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
  }, delay);
}
