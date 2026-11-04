import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { scaleLinear } from '../../utils/scale';
import type { Arm, ArmId, TaskMeta } from '../../data/types';
import { ci, pct, pts, signedPoints } from '../../data/format';
import { winsLosses } from '../../data/classify';
import { DETECTABLE, DETECTABLE_MAX, DETECTABLE_MIN, ROBUSTNESS } from '../../data/reportFigures';
import { useWidth } from '../../hooks/useWidth';
import { useInView } from '../../hooks/useInView';
import { useUi } from '../../state/sceneStore';

interface Props {
  arms: Arm[];
  tasks: TaskMeta[];
  /** id of the chart's caption, for screen readers. */
  describedBy?: string;
  /** Index into ROBUSTNESS: 0 is the full cohort; the others are the report's sensitivity views. */
  view?: number;
}

const DOMAIN: [number, number] = [-12, 12];
const COMPACT = 700;

/** True when the 95% interval includes zero: the setup can't be told apart from No setup. */
export const crossesZero = (a: Arm): boolean => a.ci_low <= 0 && a.ci_high >= 0;

/**
 * Paired difference vs No setup, in percentage points, with 95% bootstrap intervals, the per-setup
 * detectable effect and the 5.4–9.1 point band. All rows share one colour: a nominally higher
 * estimate is not drawn as an improvement. Details appear in a readout below the plot, never over it.
 */
export function IntervalChart({ arms, tasks, describedBy, view = 0 }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const width = useWidth(wrap, 1000, 300);
  const [hover, setHover] = useState<ArmId | null>(null);
  const [pinned, setPinned] = useState<ArmId | null>(null);
  const [second, setSecond] = useState<ArmId | null>(null);
  const [compare, setCompare] = useState(false);
  const [explain, setExplain] = useState<'zero' | 'band' | null>(null);
  const reduced = useUi((s) => s.reducedMotion);
  const drawn = useInView(wrap, '0px 0px -20% 0px');

  const baseline = arms.find((a) => a.id === 'none')!;
  const rows = arms.filter((a) => a.id !== 'none');
  const compact = width < COMPACT;
  const left = compact ? 4 : 232;
  const right = compact ? 4 : 190;
  const top = compact ? 48 : 50;
  const rowH = compact ? 64 : 56;
  const plotH = rows.length * rowH;
  const height = top + plotH + (compact ? 64 : 62);
  const x = useMemo(() => scaleLinear(DOMAIN, [left, width - right]), [left, right, width]);
  const ticks = compact ? [-10, -5, 0, 5, 10] : [-10, -7.5, -5, -2.5, 0, 2.5, 5, 7.5, 10];

  const shown = hover ?? pinned;
  const info = shown ? arms.find((a) => a.id === shown)! : null;
  const infoWL = info ? winsLosses(tasks, info.id) : null;
  const full = view === 0;
  /** A condition's estimate and interval, as fractions, in the chosen view. */
  const est = (a: Arm) => {
    if (full) return { d: a.diff_vs_none, lo: a.ci_low, hi: a.ci_high };
    const [d, lo, hi] = ROBUSTNESS[view].cells[a.id as Exclude<ArmId, 'none'>];
    return { d: d / 100, lo: lo / 100, hi: hi / 100 };
  };
  const crosses = (a: Arm) => { const e = est(a); return e.lo <= 0 && e.hi >= 0; };
  const nCross = rows.filter(crosses).length;

  const toggle = (id: ArmId) => {
    setExplain(null);
    if (compare && pinned && pinned !== id) { setSecond((s) => (s === id ? null : id)); return; }
    setPinned((p) => (p === id ? null : id));
    if (pinned === id) setSecond(null);
  };
  const onKey = (e: KeyboardEvent, id: ArmId) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(id); }
  };

  return (
    <div className={`ic${reduced ? '' : ' ic-anim'}${drawn ? ' is-drawn' : ''}`}>
      <div className="ic-plot" ref={wrap}>
        <svg className="ic-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}
             aria-label="Difference in solve rate versus No setup for five setups, in percentage points, with 95% intervals. Every interval crosses zero."
             aria-describedby={describedBy} role="group">
          <defs>
            <pattern id="ic-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" className="ic-hatch-line" />
            </pattern>
          </defs>

          {/* Where an effect would be detected 80% of the time (5.4–9.1 points, either direction) */}
          <rect x={x(-DETECTABLE_MAX)} y={top - 8} width={x(-DETECTABLE_MIN) - x(-DETECTABLE_MAX)} height={plotH + 8} fill="url(#ic-hatch)" />
          <rect x={x(DETECTABLE_MIN)} y={top - 8} width={x(DETECTABLE_MAX) - x(DETECTABLE_MIN)} height={plotH + 8} fill="url(#ic-hatch)" />
          {!compact && (
            <text x={x(DETECTABLE_MAX)} y={top - 16} textAnchor="end" className="ic-band-label">detectable at 80% power</text>
          )}

          {/* Grid and axis */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={top - 8} y2={top + plotH} className={t === 0 ? 'ic-zero' : 'ic-grid'} />
              <text x={x(t)} y={top + plotH + 20} className="ic-tick" textAnchor="middle">
                {t === 0 ? '0' : signedPoints(t, Number.isInteger(t) ? 0 : 1)}
              </text>
            </g>
          ))}
          <text x={x(0)} y={top - 16} textAnchor="middle" className="ic-zero-label">No setup ({pct(baseline.rate)})</text>
          <text x={x(DOMAIN[0])} y={top + plotH + 42} className="ic-dir">← lower than No setup</text>
          <text x={x(DOMAIN[1])} y={top + plotH + 42} textAnchor="end" className="ic-dir">higher than No setup →</text>
          {!compact && (
            <text x={(x(DOMAIN[0]) + x(DOMAIN[1])) / 2} y={top + plotH + 42} textAnchor="middle" className="ic-axis-title">percentage points</text>
          )}

          {rows.map((a, i) => {
            const cy = top + i * rowH + (compact ? rowH * 0.62 : rowH / 2);
            const det = DETECTABLE[a.id as Exclude<ArmId, 'none'>];
            const active = shown === a.id;
            const e = est(a);
            return (
              <g key={a.id} className={`ic-row${active ? ' is-active' : ''}${pinned === a.id || second === a.id ? ' is-pinned' : ''}`}
                 role="button" tabIndex={0} aria-pressed={pinned === a.id || second === a.id}
                 aria-label={`${a.label}: ${pts(e.d)} points versus No setup, 95% interval ${ci(e.lo, e.hi)}${crosses(a) ? ', crosses zero' : ''}.`}
                 onClick={() => toggle(a.id)} onKeyDown={(e) => onKey(e, a.id)}
                 onMouseEnter={() => setHover(a.id)} onMouseLeave={() => setHover(null)}
                 onFocus={() => setHover(a.id)} onBlur={() => setHover(null)}>
                <rect x={0} y={top + i * rowH} width={width} height={rowH} className="ic-hit" />
                {compact
                  ? <text x={left} y={cy - 17} className="ic-label">{a.label}</text>
                  : <text x={left - 20} y={cy + 5} textAnchor="end" className="ic-label">{a.label}</text>}
                {full && <line x1={x(-det.detectable)} x2={x(-det.detectable)} y1={cy - 8} y2={cy + 8} className="ic-det" />}
                {full && <line x1={x(det.detectable)} x2={x(det.detectable)} y1={cy - 8} y2={cy + 8} className="ic-det" />}
                <g className="ic-ci" style={{ transformOrigin: `${x(0)}px ${cy}px`, transitionDelay: `${i * 110}ms` }}>
                  <line x1={x(e.lo * 100)} x2={x(e.hi * 100)} y1={cy} y2={cy} className="ic-ci-line" />
                  <line x1={x(e.lo * 100)} x2={x(e.lo * 100)} y1={cy - 6} y2={cy + 6} className="ic-ci-cap" />
                  <line x1={x(e.hi * 100)} x2={x(e.hi * 100)} y1={cy - 6} y2={cy + 6} className="ic-ci-cap" />
                </g>
                <circle cx={x(e.d * 100)} cy={cy} r={compact ? 5.5 : 6.5} className="ic-dot" style={{ transitionDelay: `${i * 110 + 650}ms` }} />
                <text x={compact ? width - right : width - right + 20} y={compact ? cy - 17 : cy + 5} textAnchor={compact ? 'end' : 'start'} className="ic-value" style={{ transitionDelay: `${i * 110 + 650}ms` }}>
                  <tspan className="ic-value-est">{pts(e.d)}</tspan>
                  <tspan className="ic-value-ci"> [{pts(e.lo)}, {pts(e.hi)}]</tspan>
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="ic-tools" role="group" aria-label="Explain the chart">
        <button type="button" className="tool" aria-pressed={explain === 'zero'} onClick={() => setExplain(explain === 'zero' ? null : 'zero')}>The zero line</button>
        <button type="button" className="tool" aria-pressed={explain === 'band'} onClick={() => setExplain(explain === 'band' ? null : 'band')}>Detectable range</button>
        <button type="button" className="tool" aria-pressed={compare} onClick={() => { setCompare(!compare); setSecond(null); }}>Compare two conditions</button>
        <span className="ic-tools__status" role="status"><b>{nCross} of {rows.length}</b> intervals cross zero{full ? '' : ' in this view'}</span>
      </div>

      <div className="ic-readout" aria-live="polite">
        {explain === 'zero' ? (
          <p className="ic-readout__explain"><strong>Zero means no difference from the No setup baseline.</strong> A dot to the right of zero is a nominally
            higher solve rate, to the left a lower one. An interval that spans zero is compatible with no difference at all.</p>
        ) : explain === 'band' ? (
          <p className="ic-readout__explain"><strong>The hatched range is the study's sensitivity, not a result.</strong> A real effect of about {DETECTABLE_MIN}–{DETECTABLE_MAX} points
            would have been detected 80% of the time. The intervals are what was measured; this range is what the study could have seen. Smaller effects remain unresolved.</p>
        ) : compare && pinned && second ? (
          <div className="ic-pair">
            {[pinned, second].map((id) => {
              const a = arms.find((x) => x.id === id)!, e = est(a);
              return (
                <div key={id}>
                  <p className="ic-readout__name">{a.label}</p>
                  <dl className="ic-readout__kv">
                    <div><dt>vs No setup</dt><dd>{pts(e.d)} pts</dd></div>
                    <div><dt>95% interval</dt><dd>{ci(e.lo, e.hi)}</dd></div>
                  </dl>
                </div>
              );
            })}
            <p className="ic-readout__verdict">Each interval compares one setup with No setup. Seeing two together is not a test of one against the other, and the study did not run that test.</p>
          </div>
        ) : !info || !infoWL ? (
          <p className="ic-readout__hint">{compare ? 'Select two rows to read them together.' : 'Hover, tap or focus a row to read its numbers.'} {nCross === rows.length ? 'Every interval crosses zero.' : ''}</p>
        ) : !full ? (
          <>
            <p className="ic-readout__name">{info.label}</p>
            <dl className="ic-readout__kv">
              <div><dt>Difference vs No setup</dt><dd>{pts(est(info).d)} pts</dd></div>
              <div><dt>95% interval</dt><dd>{ci(est(info).lo, est(info).hi)}</dd></div>
            </dl>
            <p className="ic-readout__verdict">From the report's sensitivity table. Detectable effects were published for the full cohort only.</p>
          </>
        ) : (
          <>
            <p className="ic-readout__name">{info.label}</p>
            <dl className="ic-readout__kv">
              <div><dt>Difference vs No setup</dt><dd>{pts(info.diff_vs_none)} pts</dd></div>
              <div><dt>95% interval</dt><dd>{ci(info.ci_low, info.ci_high)}</dd></div>
              <div><dt>Solved</dt><dd>{info.solved}/{info.attempts} ({pct(info.rate)})</dd></div>
              <div><dt>Bugs won / lost</dt><dd>{infoWL.won} / {infoWL.lost}</dd></div>
              <div><dt>Detectable at 80% power</dt><dd>{DETECTABLE[info.id as Exclude<ArmId, 'none'>].detectable} pts</dd></div>
            </dl>
            <p className="ic-readout__verdict">
              {crossesZero(info)
                ? 'The interval crosses zero: this setup was not shown to differ from No setup.'
                : 'The interval does not cross zero.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
