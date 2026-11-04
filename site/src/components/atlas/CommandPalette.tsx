import { useEffect, useMemo, useRef, useState } from 'react';
import type { Summary } from '../../data/types';
import { atlas, openCondition, openRun, openTask, useAtlas } from '../../state/atlasStore';
import { jumpTo } from '../navigation/Nav';
import { Icon } from './Icon';
import { EmptyState } from './Primitives';
import { buildIndex, searchIndex, type PaletteItem } from './paletteIndex';

/** Ctrl/Cmd+K: search real records and jump to any part of the study. */
export function CommandPalette({ summary }: { summary: Summary | null }) {
  const open = useAtlas((s) => s.palette);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [modules, setModules] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); atlas.set({ palette: !atlas.get().palette }, 'none'); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      opener.current = document.activeElement;
      setQ(''); setActive(0);
      input.current?.focus();
      fetch(`${import.meta.env.BASE_URL}data/architecture.json`).then((r) => (r.ok ? r.json() : null)).then((d: { modules?: { name: string }[] } | null) => {
        if (d?.modules) setModules(d.modules.map((m) => m.name));
      }).catch(() => {});
    } else {
      (opener.current as HTMLElement | null)?.focus?.();
      opener.current = null;
    }
  }, [open]);

  const index = useMemo(() => (summary ? buildIndex(summary, modules) : []), [summary, modules]);
  const results = useMemo(() => searchIndex(index, q).slice(0, 40), [index, q]);
  useEffect(() => setActive(0), [q]);

  const run = (it: PaletteItem) => {
    atlas.set({ palette: false }, 'none');
    const a = it.action;
    if (a.type === 'section') jumpTo(a.id);
    else if (a.type === 'task') openTask(a.id);
    else if (a.type === 'condition') openCondition(a.id);
    else if (a.type === 'run') openRun(a.task, a.arm, a.repeat);
    else if (a.type === 'module') { window.dispatchEvent(new CustomEvent('uplift:module', { detail: a.name })); jumpTo('architecture'); }
    else if (a.type === 'hero') { atlas.set({ heroMode: a.mode }, 'push'); jumpTo('overview'); }
    else if (a.type === 'view') atlas.set({ view: a.view }, 'push');
    else if (a.type === 'tour') atlas.set({ tour: 0 }, 'none');
  };

  if (!open) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); atlas.set({ palette: false }, 'none'); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); run(results[active]); }
  };
  return (
    <div className="palette__scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) atlas.set({ palette: false }, 'none'); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search the study" onKeyDown={onKey}>
        <div className="palette__bar">
          <Icon name="search" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bugs, conditions, runs, source files…" role="combobox"
                 aria-expanded="true" aria-controls="palette-list" aria-activedescendant={results[active] ? `pal-${active}` : undefined} aria-label="Search the study" />
          <kbd>Esc</kbd>
        </div>
        {results.length === 0
          ? <EmptyState title="No matching records">Try a bug number such as 4347, a condition, or a file such as grade.py.</EmptyState>
          : (
            <ul id="palette-list" role="listbox" aria-label="Results">
              {results.map((r, i) => (
                <li key={r.key} id={`pal-${i}`} role="option" aria-selected={i === active} className={i === active ? 'is-active' : undefined}
                    onMouseEnter={() => setActive(i)} onClick={() => run(r)}>
                  <span className="palette__type">{r.type}</span>
                  <span className="palette__label">{r.label}</span>
                  {r.sub && <span className="palette__sub">{r.sub}</span>}
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
