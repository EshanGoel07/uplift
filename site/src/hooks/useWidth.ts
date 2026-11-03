import { useEffect, useState, type RefObject } from 'react';

/** Content width of an element in CSS pixels, kept up to date with a ResizeObserver. */
export function useWidth(ref: RefObject<HTMLElement | null>, fallback: number, min = 280): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(min, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, min]);
  return width;
}
