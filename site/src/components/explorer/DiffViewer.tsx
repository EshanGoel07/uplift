import { useMemo, useState } from 'react';
import { diffStats, parseDiff } from '../../utils/diff';

const PREVIEW_LINES = 48;

/** Unified diff viewer. Every line is a React text node: agent output is never parsed as HTML. */
export function DiffViewer({ diff, label }: { diff: string; label: string }) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  const stats = useMemo(() => diffStats(files), [files]);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(true);

  if (!diff.trim()) {
    return <div className="diff diff--empty"><p>The agent produced no patch in this run.</p></div>;
  }

  let budget = expanded ? Infinity : PREVIEW_LINES;
  const hidden = Math.max(0, stats.lines - PREVIEW_LINES);

  return (
    <div className="diff">
      <div className="diff__bar">
        <button type="button" className="diff__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <svg viewBox="0 0 16 16" aria-hidden="true" className={open ? 'is-open' : ''}><path d="m6 4 4 4-4 4" /></svg>
          <span className="label">Agent patch</span>
        </button>
        <span className="diff__stats mono">
          {stats.files} file{stats.files === 1 ? '' : 's'} · <span className="diff__add">+{stats.adds}</span> <span className="diff__del">−{stats.dels}</span>
        </span>
      </div>
      {open && (
        <>
          <ul className="diff__files" aria-label="Files changed">
            {files.map((f) => (
              <li key={f.path} className="mono"><span className="diff__path">{f.path}</span> <span className="diff__add">+{f.adds}</span> <span className="diff__del">−{f.dels}</span></li>
            ))}
          </ul>
          <div className="diff__body" role="region" aria-label={`${label}: unified diff`} tabIndex={0}>
            <table className="diff__table">
              <tbody>
                {files.map((f, fi) => f.lines.map((l, li) => {
                  if (budget <= 0) return null;
                  budget--;
                  const sign = l.type === 'add' ? '+' : l.type === 'del' ? '−' : '';
                  return (
                    <tr key={`${fi}-${li}`} className={`dl dl--${l.type}`}>
                      <td className="dl__ln" aria-hidden="true">{l.oldNo ?? ''}</td>
                      <td className="dl__ln" aria-hidden="true">{l.newNo ?? ''}</td>
                      <td className="dl__sign" aria-hidden="true">{sign}</td>
                      <td className="dl__code">
                        {l.type === 'add' && <span className="visually-hidden">added: </span>}
                        {l.type === 'del' && <span className="visually-hidden">removed: </span>}
                        {l.text || ' '}
                      </td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>
          {hidden > 0 && (
            <button type="button" className="btn btn--small btn--ghost diff__more" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
              {expanded ? 'Collapse patch' : `Show all ${stats.lines} lines (${hidden} more)`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
