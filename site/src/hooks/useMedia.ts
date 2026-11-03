import { useSyncExternalStore } from 'react';

/** Live media-query match (re-renders when the breakpoint is crossed). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const WIDE = '(min-width: 901px)';
