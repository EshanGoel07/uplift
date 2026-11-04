import { useEffect, useState } from 'react';
import { STORY_STATES, cohort } from '../../state/cohortStore';
import { invalidations, scenes } from '../../state/sceneStore';

/**
 * Development only, with `?overlay` on the URL: what the renderer believes, live, so a blank stage can be
 * explained rather than just seen. Production builds compile this away (see App.tsx).
 */
export default function SceneDiagnostics() {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);
  const now = performance.now();
  return (
    <pre style={{ position: 'fixed', left: 8, bottom: 8, zIndex: 100, margin: 0, padding: 10, maxWidth: 560, font: '11px/1.5 monospace', color: '#f5f1eb', background: 'rgba(9,10,12,.9)', border: '1px solid #303337', pointerEvents: 'none' }}>
      {`story  ${STORY_STATES[cohort.stage]}  settled ${cohort.settledAt === cohort.stage}  view ${cohort.view.toFixed(2)}\n`}
      {scenes.list().map((e) => {
        const r = e.stage?.getBoundingClientRect();
        return `${e.id.padEnd(10)}${scenes.phase(e.id).padEnd(10)}vis ${e.visibility.toFixed(2)}  ${r ? `${Math.round(r.width)}×${Math.round(r.height)}` : 'no stage'}  objects ${e.lastObjects}  drawn ${e.draws ? `${Math.round(now - e.lastDraw)} ms ago` : 'never'}\n`;
      }).join('')}
      {`invalidations ${JSON.stringify(invalidations)}`}
    </pre>
  );
}
