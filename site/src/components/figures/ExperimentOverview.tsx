import { useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Summary } from '../../data/types';
import { int } from '../../data/format';
import { shortId } from '../../data/classify';
import { FEATURED_TASK } from '../../data/reportFigures';
import { useWidth } from '../../hooks/useWidth';

const NARROW = 720;

/**
 * The paired design, drawn from the data's own dimensions: one column per bug, one row per
 * condition, one tick per run. Every column crosses every row, which is what "paired" means here.
 * It shows structure only; outcomes are in the findings and the run explorer.
 */
export function ExperimentOverview({ summary }: { summary: Summary }) {
  const wrap = useRef<HTMLDivElement>(null);
  const width = useWidth(wrap, 1180);
  const [hover, setHover] = useState<number | null>(null);

  const tasks = useMemo(
    () => [...summary.tasks.filter((t) => t.set === 'test'), ...summary.tasks.filter((t) => t.set === 'fresh')],
    [summary],
  );
  const nTest = tasks.filter((t) => t.set === 'test').length;
  const nFresh = tasks.length - nTest;
  const arms = summary.arms;
  const repeats = Math.round(arms[0].attempts / tasks.length);
  const featured = Math.max(0, tasks.findIndex((t) => t.id === FEATURED_TASK));
  const hi = hover ?? featured;

  const wide = width >= NARROW;
  const L = wide ? 196 : 0;
  const R = wide ? 92 : 0;
  const GAP = wide ? 18 : 10;
  const pitch = (width - L - R - GAP) / tasks.length;
  const colX = (i: number) => L + i * pitch + (i >= nTest ? GAP : 0);

  const sq = Math.max(2.5, Math.min(10, pitch - 2));
  const squaresTop = wide ? 30 : 22;
  const rowsTop = wide ? 64 : 46;
  const rowH = wide ? 30 : 34;
  const tickTop = wide ? 8 : 17;
  const tickH = wide ? 14 : 11;
  const rowsEnd = rowsTop + arms.length * rowH;
  const height = rowsEnd + (wide ? 34 : 30);

  const gapT = pitch > 6 ? 1.5 : 0.8;
  const tw = Math.max(1.1, Math.min(4, (pitch - 1.6 - gapT) / repeats));
  const inset = (pitch - (repeats * tw + (repeats - 1) * gapT)) / 2;

  // All ticks of a row as one path: fewer DOM nodes than 924 rects.
  const rowPath = (y: number) => {
    let d = '';
    for (let i = 0; i < tasks.length; i++) {
      for (let k = 0; k < repeats; k++) {
        const x = colX(i) + inset + k * (tw + gapT);
        d += `M${x.toFixed(2)} ${y}h${tw.toFixed(2)}v${tickH}h${(-tw).toFixed(2)}Z`;
      }
    }
    return d;
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    if (x < L || x > width - R) { setHover(null); return; }
    const local = x - L;
    const split = nTest * pitch + GAP / 2;
    const i = local > split ? nTest + Math.floor((local - nTest * pitch - GAP) / pitch) : Math.floor(local / pitch);
    setHover(Math.min(tasks.length - 1, Math.max(0, i)));
  };

  const hiTask = tasks[hi];
  const total = summary.summary.runs;

  return (
    <figure className="overview" aria-labelledby="overview-caption">
      <div className="overview__stage" ref={wrap}>
        <svg className="overview__svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}
             role="img" aria-label={`${tasks.length} bugs, each run ${repeats} times under each of ${arms.length} conditions: ${int(total)} runs.`}
             onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {/* Bug groups */}
          <text x={colX(0)} y={wide ? 14 : 11} className="ov-group">{wide ? `${nTest} test bugs · SWE-rebench, 2024` : `${nTest} test`}</text>
          <text x={colX(nTest)} y={wide ? 14 : 11} className="ov-group">{wide ? `${nFresh} fresh bugs · fixed Apr–Oct 2026` : `${nFresh} fresh`}</text>
          {wide && (
            <>
              <line x1={colX(0)} x2={colX(nTest - 1) + pitch} y1={21} y2={21} className="ov-bracket" />
              <line x1={colX(nTest)} x2={colX(tasks.length - 1) + pitch} y1={21} y2={21} className="ov-bracket" />
              <text x={0} y={squaresTop + sq - 1} className="ov-row-label">{tasks.length} bugs</text>
              <text x={width - R + 14} y={squaresTop + sq - 1} className="ov-total">{tasks.length}</text>
            </>
          )}

          {/* Highlighted column: one bug crossing every condition */}
          <rect x={colX(hi) - 1.5} y={squaresTop - 4} width={pitch + 3} height={rowsEnd - squaresTop + 6} className="ov-hi" rx={2} />

          {/* Column guides (wide only: on phones they would merge into a wash) */}
          {wide && tasks.map((_, i) => (
            <line key={i} x1={colX(i) + pitch / 2} x2={colX(i) + pitch / 2} y1={squaresTop + sq + 3} y2={rowsTop} className="ov-guide" />
          ))}

          {/* One mark per bug: filled = test, outlined = fresh */}
          {tasks.map((t, i) => {
            const x = colX(i) + (pitch - sq) / 2;
            return t.set === 'test'
              ? <rect key={t.id} x={x} y={squaresTop} width={sq} height={sq} className={`ov-task${i === hi ? ' is-hi' : ''}`} />
              : <rect key={t.id} x={x + 0.6} y={squaresTop + 0.6} width={sq - 1.2} height={sq - 1.2} className={`ov-task ov-task--fresh${i === hi ? ' is-hi' : ''}`} />;
          })}

          {/* Six condition rows, two runs per bug */}
          {arms.map((a, r) => {
            const top = rowsTop + r * rowH;
            const labelY = wide ? top + 19 : top + 11;
            return (
              <g key={a.id}>
                {wide && <line x1={L} x2={width - R} y1={top} y2={top} className="ov-row-rule" />}
                <text x={0} y={labelY} className="ov-row-label">{a.label}</text>
                <path d={rowPath(top + tickTop)} className="ov-runs" />
                {Array.from({ length: repeats }, (_, k) => (
                  <rect key={k} x={colX(hi) + inset + k * (tw + gapT)} y={top + tickTop} width={tw} height={tickH} className="ov-runs-hi" />
                ))}
                <text x={wide ? width - R + 14 : width} y={labelY} textAnchor={wide ? 'start' : 'end'} className="ov-total">
                  {int(a.attempts)}{wide ? ' runs' : ''}
                </text>
              </g>
            );
          })}

          <line x1={wide ? L : 0} x2={width} y1={rowsEnd + 8} y2={rowsEnd + 8} className="ov-sum-rule" />
          <text x={width} y={rowsEnd + (wide ? 27 : 24)} textAnchor="end" className="ov-sum">
            {arms.length} × {tasks.length} × {repeats} = <tspan className="ov-sum-total">{int(total)} runs</tspan>
          </text>
        </svg>

        <p className="overview__readout">
          <span className="overview__readout-k">{hover === null ? 'Highlighted bug' : 'Bug under the pointer'}</span>{' '}
          <span className="overview__id">{shortId(hiTask.id)}</span>{' '}
          <span className="overview__title">{hiTask.title}</span>
          <span className="overview__runs">{arms.length * repeats} runs: every condition, {repeats} repeats each</span>
        </p>
      </div>

      <div className="overview__foot">
        <ul className="overview__legend" aria-label="Legend">
          <li><i className="lg-sq" aria-hidden="true" /> Test bug (SWE-rebench, 2024)</li>
          <li><i className="lg-sq lg-sq--fresh" aria-hidden="true" /> Fresh bug (fixed in 2026)</li>
          <li><i className="lg-tick" aria-hidden="true" /> One run</li>
          <li><i className="lg-col" aria-hidden="true" /> One bug across all six conditions</li>
        </ul>
        <figcaption id="overview-caption" className="caption">
          <span className="caption__n">Figure 1.</span> The paired design. Each column is one of the {tasks.length} bugs, each row is
          one of the {arms.length} conditions, and each tick is one run. Every bug ran {repeats} times under every condition,
          so each condition is compared with No setup on exactly the same bugs ({arms.length} × {tasks.length} × {repeats} = {int(total)} runs).
        </figcaption>
      </div>
    </figure>
  );
}
