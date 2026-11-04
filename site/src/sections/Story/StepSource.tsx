import { useState } from 'react';
import { REPO_URL } from '../../data/links';
import { sourcePath } from '../Architecture/types';
import { Icon } from '../../components/atlas/Icon';

export interface SourceRef { file: string; start: number; end: number; anchor: string }

/** The real lines behind a step, read from the published copy of the source when the reader asks for them. */
export function StepSource({ source }: { source: SourceRef }) {
  const [text, setText] = useState<string | null>(null);
  const load = (open: boolean) => {
    if (!open || text !== null) return;
    fetch(sourcePath(source.file)).then((r) => (r.ok ? r.text() : Promise.reject(new Error('missing'))))
      .then((t) => setText(t.split('\n').slice(source.start - 1, source.end).join('\n')))
      .catch(() => setText(''));
  };
  return (
    <details className="story__source" onToggle={(e) => load(e.currentTarget.open)}>
      <summary><Icon name="source" size={13} /><code>{source.file}:{source.start}</code></summary>
      {text === null ? <p>Loading the source.</p> : text ? <pre tabIndex={0}><code>{text}</code></pre> : <p>The source excerpt could not be loaded.</p>}
      <a href={`${REPO_URL}/blob/main/${source.file}#L${source.start}-L${source.end}`} target="_blank" rel="noreferrer">View on GitHub</a>
    </details>
  );
}
