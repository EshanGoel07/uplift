import type { ReactNode } from 'react';

/** One of the five destinations: a labelled region holding the sections that answer its question. */
export function Chapter({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div id={id} className="chapter" role="region" aria-label={label}>{children}</div>;
}
