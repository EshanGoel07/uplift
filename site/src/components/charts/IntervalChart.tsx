import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { scaleLinear } from '../../utils/scale';
import type { Arm, ArmId, TaskMeta } from '../../data/types';
import { ci, pct, pts, signedPoints } from '../../data/format';
import { winsLosses } from '../../data/classify';
import { DETECTABLE, DETECTABLE_MAX, DETECTABLE_MIN } from '../../data/reportFigures';
import { gsap, useGsap } from '../../hooks/useGsap';
import { useUi } from '../../state/sceneStore';

interface Props {
  arms: Arm[];
  tasks: TaskMeta[];
  selected: ArmId[];
  onToggle: (id: ArmId) => void;
  describedBy?: string;
}

const DOMAIN: [number, number] = [-10, 10];
const ROW_H = 58;

/** Paired difference vs No setup, in percentage points, with 95% bootstrap intervals. */
export function IntervalChart({ arms, tasks, selected, onToggle, describedBy }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);
  const [hover, setHover] = useState<{ id: ArmId; x: number; y: number } | null>(null);
  const reduced = useUi((s) => s.reducedMotion);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const baseline = arms.find((a) => a.id === 'none')!;
  const rows = arms.filter((a) => a.id !== 'none');
  const compact = width < 680;
  const left = compact ? 12 : 210;
  const right = compact ? 12 : 150;
  const top = compact ? 74 : 64;
  const height = top + rows.length * ROW_H + 52;
  const x = useMemo(() => scaleLinear(DOMAIN, [left, width - right]), [left, right, width]);
  const ticks = [-10, -7.5, -5, -2.5, 0, 2.5, 5, 7.5, 10];

  useGsap(wrap, () => {
    if (reduced) return;
    gsap.from('.ic-ci', { scaleX: 0, transformOrigin: 'center', duration: 0.9, ease: 'power3.out', stagger: 0.09,
      scrollTrigger: { trigger: wrap.current, start: 'top 80%', once: true } });
    gsap.from('.ic-dot', { scale: 0, transformOrigin: 'center', duration: 0.5, ease: 'back.out(2)', stagger: 0.09, delay: 0.25,
      scrollTrigger: { trigger: wrap.current, start: 'top 80%', once: true } });
  }, [reduced, rows.length]);

  const onKey = (e: KeyboardEvent, id: ArmId) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(id); }
  };

  const hovered = hover ? arms.find((a) => a.id === hover.id)! : null;
  const hoveredWL = hovered ? winsLosses(tasks, hovered.id) : null;

  return (
    <div className="ic" ref={wrap}>
      <svg className="ic-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
           aria-label="Difference in solve rate versus No setup for five setups, in percentage points, with 95% intervals. Every interval crosses zero."
           aria-describedby={describedBy}>
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="ic-hatch-line" />
          </pattern>
        </defs>

        {/* Region an effect must reach to be detected 80% of the time */}
        <rect x={x(-DETECTABLE_MAX)} y={top - 22} width={x(-DETECTABLE_MIN) - x(-DETECTABLE_MAX)} height={rows.length * ROW_H + 22} fill="url(#hatch)" className="ic-band" />
        <rect x={x(DETECTABLE_MIN)} y={top - 22} width={x(DETECTABLE_MAX) - x(DETECTABLE_MIN)} height={rows.length * ROW_H + 22} fill="url(#hatch)" className="ic-band" />
        <rect x={x(-DETECTABLE_MIN)} y={top - 22} width={x(DETECTABLE_MIN) - x(-DETECTABLE_MIN)} height={rows.length * ROW_H + 22} className="ic-blind" />
        <text x={compact ? x(DETECTABLE_MAX) : x(DETECTABLE_MIN) + 4} y={top - (compact ? 26 : 28)} textAnchor={compact ? 'end' : 'start'} className="ic-band-label">
          {compact ? `detectable: ${DETECTABLE_MIN}–${DETECTABLE_MAX} pts` : `detectable at 80% power: ${DETECTABLE_MIN}–${DETECTABLE_MAX} pts`}
        </text>

        {/* Axis */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 8} y2={top + rows.length * ROW_H} className={t === 0 ? 'ic-zero' : 'ic-grid'} />
            {(!compact || Number.isInteger(t / 5)) && (
              <text x={x(t)} y={top + rows.length * ROW_H + 20} className="ic-tick" textAnchor="middle">{t === 0 ? '0' : signedPoints(t, Number.isInteger(t) ? 0 : 1)}</text>
            )}
          </g>
        ))}
        <text x={x(0)} y={top - (compact ? 44 : 40)} textAnchor="middle" className="ic-zero-label">No setup ({pct(baseline.rate)})</text>
        <text x={(x(DOMAIN[0]) + x(DOMAIN[1])) / 2} y={height - 6} textAnchor="middle" className="ic-axis-title">difference vs No setup, percentage points</text>
        <text x={x(DOMAIN[0])} y={top + rows.length * ROW_H + 36} className="ic-dir">← worse than none</text>
        <text x={x(DOMAIN[1])} y={top + rows.length * ROW_H + 36} textAnchor="end" className="ic-dir">better than none →</text>

        {rows.map((a, i) => {
          const cy = top + i * ROW_H + ROW_H / 2;
          const sel = selected.includes(a.id);
          const det = DETECTABLE[a.id as Exclude<ArmId, 'none'>];
          return (
            <g key={a.id} className={`ic-row${sel ? ' is-selected' : ''}`} role="button" tabIndex={0} aria-pressed={sel}
               aria-label={`${a.label}: ${pts(a.diff_vs_none)} points, 95% interval ${ci(a.ci_low, a.ci_high)}. ${sel ? 'Selected.' : 'Press to select for comparison.'}`}
               onClick={() => onToggle(a.id)} onKeyDown={(e) => onKey(e, a.id)}
               onMouseMove={(e) => {
                 const r = wrap.current!.getBoundingClientRect();
                 setHover({ id: a.id, x: e.clientX - r.left, y: e.clientY - r.top });
               }}
               onMouseLeave={() => setHover(null)}
               onFocus={() => setHover({ id: a.id, x: x(a.diff_vs_none * 100), y: cy - 10 })}
               onBlur={() => setHover(null)}>
              <rect x={0} y={cy - ROW_H / 2} width={width} height={ROW_H} className="ic-hit" />
              {compact
                ? <text x={left} y={cy - 14} className="ic-label">{a.label}</text>
                : <text x={left - 18} y={cy + 4} textAnchor="end" className="ic-label">{a.label}</text>}
              <line x1={x(-det.detectable)} x2={x(-det.detectable)} y1={cy - 7} y2={cy + 7} className="ic-det" />
              <line x1={x(det.detectable)} x2={x(det.detectable)} y1={cy - 7} y2={cy + 7} className="ic-det" />
              <g className="ic-ci">
                <line x1={x(a.ci_low * 100)} x2={x(a.ci_high * 100)} y1={cy} y2={cy} className="ic-ci-line" />
                <line x1={x(a.ci_low * 100)} x2={x(a.ci_low * 100)} y1={cy - 6} y2={cy + 6} className="ic-ci-cap" />
                <line x1={x(a.ci_high * 100)} x2={x(a.ci_high * 100)} y1={cy - 6} y2={cy + 6} className="ic-ci-cap" />
              </g>
              <circle cx={x(a.diff_vs_none * 100)} cy={cy} r={6.5} className="ic-dot" />
              {!compact && (
                <text x={width - right + 16} y={cy + 4} className="ic-value">
                  <tspan className="ic-value-est">{pts(a.diff_vs_none)}</tspan>
                  <tspan className="ic-value-ci"> [{pts(a.ci_low)}, {pts(a.ci_high)}]</tspan>
                </text>
              )}
              {compact && (
                <text x={width - right} y={cy - 14} textAnchor="end" className="ic-value">
                  <tspan className="ic-value-est">{pts(a.diff_vs_none)}</tspan>
                  <tspan className="ic-value-ci"> [{pts(a.ci_low)}, {pts(a.ci_high)}]</tspan>
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hovered && hover && hoveredWL && (
        <div className="tooltip ic-tooltip" style={{ left: Math.min(hover.x + 14, width - 270), top: hover.y + 14 }} role="status">
          <p className="tooltip__title">{hovered.label}</p>
          <dl className="kv">
            <dt>Difference</dt><dd className="mono">{pts(hovered.diff_vs_none)} pts</dd>
            <dt>95% interval</dt><dd className="mono">{ci(hovered.ci_low, hovered.ci_high)}</dd>
            <dt>Solved</dt><dd className="mono">{hovered.solved}/{hovered.attempts} ({pct(hovered.rate)})</dd>
            <dt>Tasks won / lost</dt><dd className="mono">{hoveredWL.won} / {hoveredWL.lost}</dd>
            <dt>Detectable at 80%</dt><dd className="mono">{DETECTABLE[hovered.id as Exclude<ArmId, 'none'>].detectable} pts</dd>
          </dl>
          <p className="tooltip__note">Paired over {tasks.length} tasks × 2 repeats</p>
        </div>
      )}
    </div>
  );
}
