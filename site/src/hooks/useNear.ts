import { useEffect, useState } from 'react';

const RETRY_MS = 400;

/**
 * True once the element matching `selector` is within `margin` of the viewport, and stays true.
 * The element may not exist yet (sections wait for data), so it retries; at most one retry is ever
 * pending, and unmounting cancels it and blocks any late observer callback.
 */
export function useNear(selector: string, margin: string): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) return;
    let alive = true;
    let retry = 0;
    let io: IntersectionObserver | null = null;
    const attach = () => {
      retry = 0;
      if (!alive) return;
      const el = document.querySelector(selector);
      if (!el) { retry = window.setTimeout(attach, RETRY_MS); return; }
      if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
      io = new IntersectionObserver(([e]) => {
        if (alive && e.isIntersecting) { setNear(true); io?.disconnect(); }
      }, { rootMargin: margin });
      io.observe(el);
    };
    attach();
    return () => {
      alive = false;
      if (retry) window.clearTimeout(retry);
      io?.disconnect();
    };
  }, [selector, margin, near]);
  return near;
}
