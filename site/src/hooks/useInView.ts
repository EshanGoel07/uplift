import { useEffect, useState, type RefObject } from 'react';

/** True once (or while, if `once` is false) the element is within `rootMargin` of the viewport. */
export function useInView(ref: RefObject<Element | null>, rootMargin = '0px', once = true): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); if (once) io.disconnect(); }
      else if (!once) setInView(false);
    }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, once]);
  return inView;
}
