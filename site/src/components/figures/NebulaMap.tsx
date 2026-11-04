import { useMemo } from 'react';
import type { Summary, TaskMeta } from '../../data/types';
import { GROUP_LABEL, GROUP_ORDER, groupOf, shortId } from '../../data/classify';
import { openTask, useAtlas } from '../../state/atlasStore';

/**
 * The 77 bugs without WebGL: for phones and for browsers without a working 3D context. Every bug is a
 * real button, grouped by what actually happened to it. It carries the same selection as the Nebula.
 */
export function NebulaMap({ summary }: { summary: Summary }) {
  const selected = useAtlas((s) => s.task);
  const groups = useMemo(() => {
    const out: Record<string, TaskMeta[]> = { always: [], mixed: [], never: [] };
    for (const t of summary.tasks) out[groupOf(t.solved)].push(t);
    return out;
  }, [summary]);
  return (
    <div className="nebmap" role="group" aria-label={`All ${summary.tasks.length} bugs, grouped by outcome`}>
      {GROUP_ORDER.map((g) => (
        <section key={g} className={`nebmap__group nebmap__group--${g}`}>
          <h3 className="nebmap__title"><b>{groups[g].length}</b> {GROUP_LABEL[g].toLowerCase()}</h3>
          <ul>
            {groups[g].map((t) => (
              <li key={t.id}>
                <button type="button" className={t.id === selected ? 'is-sel' : undefined} aria-pressed={t.id === selected}
                        aria-label={`${shortId(t.id)}: ${t.title}`} title={t.title} onClick={() => openTask(t.id)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
