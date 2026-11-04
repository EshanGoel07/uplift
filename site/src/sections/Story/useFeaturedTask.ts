import { useEffect, useState } from 'react';
import { loadTask } from '../../data/load';
import { FEATURED_TASK } from '../../data/reportFigures';
import type { Task } from '../../data/types';

/** The WINDOW bug's published record, fetched only as its section comes near. A model works without it. */
export function useFeaturedTask(sectionId: string, ready: boolean): Task | null {
  const [task, setTask] = useState<Task | null>(null);
  useEffect(() => {
    const el = ready ? document.getElementById(sectionId) : null;
    if (!el) return;
    let on = true;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      loadTask(FEATURED_TASK).then((t) => { if (on) setTask(t); }).catch(() => {});
    }, { rootMargin: '900px 0px' });
    io.observe(el);
    return () => { on = false; io.disconnect(); };
  }, [sectionId, ready]);
  return task;
}
