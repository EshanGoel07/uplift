import { useMemo, useState } from 'react';
import { diffStats, parseDiff, type DiffLine } from '../../utils/diff';
import { highlightPython } from '../../utils/highlight';

const PREVIEW_LINES = 60;

function Code({ line, py }: { line: DiffLine; py: boolean }) {
  if (!py || !line.text) return <>{line.text || ' '}</>;
  return <>{highlightPython(line.text).map((p, i) => (p.k === 'txt' ? p.t : <span key={i} className={`hl-${p.k}`}>{p.t}</span>))}</>;
}

/**
 * Unified diff viewer: one block per file with its path and hunk headers, old/new line numbers, and
 * light Python highlighting. Every piece of agent output is a React text node, never parsed as HTML.
 */
export function DiffViewer({ diff, label, preview = PREVIEW_LINES }: { diff: string; label: string; preview?: number }) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  const stats = useMemo(() => diffStats(files), [files]);
  const [expanded, setExpanded] = useState(false);

  if (!diff.trim()) {
    return <div className="diff diff--empty"><p>The agent produced no patch in this run.</p></div>;
  }

  // Count only lines that are shown (file metadata lines like "index ..." are hidden).
  const shown = (l: DiffLine) => l.type !== 'meta' && l.type !== 'file';
  const total = files.reduce((a, f) => a + f.lines.filter(shown).length, 0);
  let budget = expanded ? Infinity : preview;
  const hidden = Math.max(0, total - preview);

  return (
    <div className="diff">
      <div className="diff__bar">
        <span className="diff__title">Agent patch</span>
        <span className="diff__stats">
          {stats.files} file{stats.files === 1 ? '' : 's'} · <span className="diff__add">+{stats.adds}</span> <span className="diff__del">−{stats.dels}</span>
        </span>
      </div>
      <div className="diff__body" role="region" aria-label={`${label}: unified diff`} tabIndex={0}>
        {files.map((f, fi) => {
          const py = f.path.endsWith('.py');
          const rows = f.lines.filter(shown);
          if (budget <= 0) return null;
          return (
            <div key={`${f.path}${fi}`} className="diff__file">
              <p className="diff__path"><span>{f.path}</span><span className="diff__fstats"><span className="diff__add">+{f.adds}</span> <span className="diff__del">−{f.dels}</span></span></p>
              <table className="diff__table">
                <tbody>
                  {rows.map((l, li) => {
                    if (budget <= 0) return null;
                    budget--;
                    if (l.type === 'hunk') {
                      return <tr key={li} className="dl dl--hunk"><td className="dl__ln" aria-hidden="true">…</td><td className="dl__ln" aria-hidden="true" /><td className="dl__sign" aria-hidden="true" /><td className="dl__code">{l.text}</td></tr>;
                    }
                    const sign = l.type === 'add' ? '+' : l.type === 'del' ? '−' : '';
                    return (
                      <tr key={li} className={`dl dl--${l.type}`}>
                        <td className="dl__ln" aria-hidden="true">{l.oldNo ?? ''}</td>
                        <td className="dl__ln" aria-hidden="true">{l.newNo ?? ''}</td>
                        <td className="dl__sign" aria-hidden="true">{sign}</td>
                        <td className="dl__code">
                          {l.type === 'add' && <span className="visually-hidden">added: </span>}
                          {l.type === 'del' && <span className="visually-hidden">removed: </span>}
                          <Code line={l} py={py} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      {hidden > 0 && (
        <button type="button" className="diff__more" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? 'Collapse patch' : `Show all ${total} lines (${hidden} more)`}
        </button>
      )}
    </div>
  );
}
