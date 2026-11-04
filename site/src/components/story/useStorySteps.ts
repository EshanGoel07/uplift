import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Which step of a vertical story is current. The page scrolls natively: nothing here listens to the
 * wheel, pins anything or moves the page by itself. A step is current while it crosses the middle of the
 * viewport, so reversing, jumping and fast scrolling all land on the right step, because the state only
 * ever depends on where the reader is now.
 */
export function useStorySteps(count: number) {
  const [active, setActive] = useState(0);
  const steps = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const inBand = new Set<number>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const i = steps.current.indexOf(e.target as HTMLElement);
        if (i < 0) continue;
        if (e.isIntersecting) inBand.add(i); else inBand.delete(i);
      }
      if (inBand.size) setActive(Math.max(...inBand));
    }, { rootMargin: '-46% 0px -46% 0px' });
    steps.current.slice(0, count).forEach((el) => { if (el) io.observe(el); });
    return () => io.disconnect();
  }, [count]);

  /** Moves the reader to a step by ordinary scrolling, so everything stays reversible. */
  const select = useCallback((i: number) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    steps.current[i]?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    setActive(i);
  }, []);

  const bind = useCallback((i: number) => (el: HTMLElement | null) => { steps.current[i] = el; }, []);

  return { active, bind, select };
}
