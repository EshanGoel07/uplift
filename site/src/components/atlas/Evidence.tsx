import { useState } from 'react';
import { EVIDENCE, STATUS_LABEL, evidenceById, type Evidence } from '../../data/evidence';
import { REPO_URL } from '../../data/links';
import { atlas } from '../../state/atlasStore';
import { Icon } from './Icon';
import { Kicker } from './Primitives';

const fileUrl = (e: Evidence): string | null => (e.path ? `${REPO_URL}/blob/main/${e.path}` : null);

/** A small source marker beside a claim; it opens the provenance record in the inspector. */
export function EvidenceBadge({ id }: { id: string }) {
  const e = evidenceById(id);
  if (!e) return null;
  return (
    <button type="button" className={`ev ev--${e.status}`} title={`Source: ${e.source}`} aria-label={`Evidence ${e.id}: ${STATUS_LABEL[e.status]}. ${e.source}`}
            onClick={() => atlas.set({ inspector: { kind: 'evidence', id } }, 'none')}>
      <Icon name="source" size={12} />{e.id}
    </button>
  );
}

export function EvidenceDetail({ id }: { id: string }) {
  const e = evidenceById(id);
  if (!e) return null;
  const url = fileUrl(e);
  return (
    <>
      <header className="insp__head">
        <Kicker>Evidence {e.id}</Kicker>
        <h2 className="insp__title" id="inspector-title" tabIndex={-1}>{e.claim}</h2>
      </header>
      <p><span className={`ev-status ev-status--${e.status}`}>{STATUS_LABEL[e.status]}</span></p>
      <dl className="meta">
        <div className="meta__row"><dt>Source</dt><dd>{e.source}</dd></div>
        {e.path && <div className="meta__row"><dt>Path</dt><dd><code>{e.path}</code></dd></div>}
        {e.anchor && <div className="meta__row"><dt>Look for</dt><dd>{e.anchor}</dd></div>}
      </dl>
      {e.note && <p className="muted">{e.note}</p>}
      {url && <p><a href={url} target="_blank" rel="noopener noreferrer">Open the source on GitHub <Icon name="external" size={12} /></a></p>}
    </>
  );
}

/** The full ledger, filterable by status. */
export function EvidenceLedger() {
  const [filter, setFilter] = useState<'all' | Evidence['status']>('all');
  const rows = filter === 'all' ? EVIDENCE : EVIDENCE.filter((e) => e.status === filter);
  return (
    <div className="ledger">
      <div className="seg" role="group" aria-label="Evidence status">
        {(['all', 'published', 'audited', 'unavailable'] as const).map((f) => (
          <button key={f} type="button" className="seg__btn" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? `All (${EVIDENCE.length})` : STATUS_LABEL[f]}</button>
        ))}
      </div>
      <div className="pub-table-wrap">
        <table className="pub-table ledger__table">
          <caption>Each claim, its source, and how far it can be followed. Audited means the report publishes the figure but not the raw artifact behind it.</caption>
          <thead><tr><th scope="col">ID</th><th scope="col">Claim</th><th scope="col">Status</th><th scope="col">Source</th></tr></thead>
          <tbody>
            {rows.map((e) => {
              const url = fileUrl(e);
              return (
                <tr key={e.id}>
                  <th scope="row"><span className="mono">{e.id}</span></th>
                  <td>{e.claim}{e.note && <span className="td-sub">{e.note}</span>}</td>
                  <td><span className={`ev-status ev-status--${e.status}`}>{STATUS_LABEL[e.status]}</span></td>
                  <td>{url ? <a href={url} target="_blank" rel="noopener noreferrer"><code>{e.path}</code></a> : e.source}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
