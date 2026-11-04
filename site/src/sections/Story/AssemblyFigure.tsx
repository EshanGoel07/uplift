import type { ReactNode } from 'react';
import { INTERFACE, OUTCOME, SPECTRAL } from '../../scenes/colors';
import type { Form, Model, Part } from '../../state/assemblyStore';

type Box = [x: number, y: number, w: number, h: number];

const Lines = ({ x, y, w, h, n, color }: { x: number; y: number; w: number; h: number; n: number; color: string }) => {
  const rows = Math.min(n, Math.floor(h / 6));
  return <>{Array.from({ length: rows }, (_, i) => <line key={i} x1={x} x2={x + w * (0.45 + 0.5 * (((i * 7) % 5) / 4))} y1={y + 3 + (i * h) / rows} y2={y + 3 + (i * h) / rows} stroke={color} strokeWidth="1.5" />)}</>;
};

/** One object as a small drawing: the same idea as its 3D form, so the phone story teaches the same thing. */
function glyph(form: Form, [x, y, w, h]: Box, accent: string): ReactNode {
  const plate = { fill: 'var(--graphite)', stroke: accent, strokeWidth: 1 };
  switch (form.kind) {
    case 'repo': {
      const cols = [0.34, 0.24, 0.42], out: ReactNode[] = [<rect key="b" x={x} y={y} width={w} height={h} rx="3" {...plate} />];
      let cx = x + 4;
      cols.forEach((c, i) => {
        const cw = (w - 8) * c;
        for (let r = 0; r < 3; r++) out.push(<rect key={`${i}${r}`} x={cx + 1} y={y + 4 + (r * (h - 8)) / 3} width={cw - 3} height={(h - 8) / 3 - 2} rx="1" fill="var(--carbon)" stroke={i ? SPECTRAL.blue : SPECTRAL.cyan} strokeOpacity="0.85" />);
        cx += cw;
      });
      return out;
    }
    case 'sheet': return <><rect x={x} y={y} width={w} height={h} rx="2" {...plate} /><Lines x={x + 7} y={y + 9} w={w - 14} h={h - 14} n={form.lines.length} color={form.shape === 'ticket' ? SPECTRAL.amber : form.color} /></>;
    case 'diff': {
      const rows = form.lines.slice(0, Math.floor((h - 8) / 4));
      return <><rect x={x} y={y} width={w} height={h} rx="2" {...plate} />{rows.map((l, i) => <line key={i} x1={x + 8} x2={x + 8 + (w - 14) * Math.max(0.1, l.len)} y1={y + 6 + i * 4} y2={y + 6 + i * 4} strokeWidth="1.5" stroke={l.tone === 'add' ? OUTCOME.solved : l.tone === 'del' ? OUTCOME.failed : l.tone === 'hunk' ? SPECTRAL.cyan : INTERFACE.text3} />)}</>;
    }
    case 'core': return <><ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 3.2} fill="none" stroke={SPECTRAL.amber} /><circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 3.4} fill={SPECTRAL.amber} fillOpacity="0.28" stroke={SPECTRAL.core} /></>;
    case 'hooks': {
      const mx = x + w * 0.2, ys = [y + h * 0.3, y + h * 0.75];
      return <>{form.checks.includes('lint') || form.checks.includes('cochange') ? <circle cx={mx} cy={ys[0]} r="7" {...plate} /> : null}{form.checks.includes('verify') && <><circle cx={mx} cy={ys[1]} r="7" {...plate} /><line x1={mx + 7} x2={x + w * 0.74} y1={ys[1]} y2={ys[1]} stroke={accent} /><rect x={x + w * 0.74} y={ys[1] - 7} width="14" height="14" transform={`rotate(45 ${x + w * 0.74 + 7} ${ys[1]})`} {...plate} /></>}{form.checks.includes('lint') && <><line x1={mx + 7} x2={x + w * 0.66} y1={ys[0]} y2={y + h * 0.15} stroke={accent} /><rect x={x + w * 0.66} y={y + h * 0.05} width={w * 0.3} height="10" {...plate} /></>}{form.checks.includes('cochange') && <><line x1={mx + 7} x2={x + w * 0.66} y1={ys[0]} y2={y + h * 0.45} stroke={accent} /><circle cx={x + w * 0.7} cy={y + h * 0.45} r="5" {...plate} /><circle cx={x + w * 0.86} cy={y + h * 0.45} r="5" {...plate} /></>}</>;
    }
    case 'commit': return <><circle cx={x + w * 0.8} cy={y + h / 2} r="8" fill="none" stroke={form.color} strokeWidth="3" /><circle cx={x + w * 0.42} cy={y + h / 2} r="5" fill="none" stroke={INTERFACE.text3} strokeDasharray="2 2" /><circle cx={x + w * 0.14} cy={y + h / 2} r="5" fill="none" stroke={INTERFACE.text3} strokeDasharray="2 2" /></>;
    case 'ghost': return <><rect x={x} y={y} width={w} height={h} fill="none" stroke={form.color} strokeDasharray="5 4" /><path d={`M${x + w / 2 - 7} ${y + h / 2 - 7}l14 14m0 -14l-14 14`} stroke={form.color} /></>;
    case 'room': return <path d={`M${x} ${y + h}H${x + w}M${x + w * 0.06} ${y + h}V${y}H${x + w * 0.94}V${y + h}`} fill="rgba(23,26,29,.5)" stroke={SPECTRAL.blue} strokeOpacity="0.7" />;
    case 'rail': {
      const n = form.ticks.length;
      return <><line x1={x} x2={x + w * 0.28} y1={y + h / 2} y2={y + h / 2} stroke={SPECTRAL.amber} strokeWidth="2" /><line x1={x + w * 0.28} x2={x + w} y1={y + h / 2} y2={y + h / 2} stroke={SPECTRAL.cyan} strokeWidth="2" />{form.ticks.map((_, i) => <line key={i} x1={x + (w * i) / (n - 1)} x2={x + (w * i) / (n - 1)} y1={y} y2={y + h} stroke={INTERFACE.text2} />)}</>;
    }
    case 'marker': return <path d={`M${x} ${y}h${w}l${-w / 2} ${h}z`} fill={INTERFACE.ember} />;
    case 'sealed': return <><rect x={x} y={y} width={w} height={h} rx="3" fill="var(--graphite)" stroke={form.color} /><path d={`M${x + w / 2} ${y}v${h}M${x} ${y + h / 2}h${w}`} stroke={SPECTRAL.violet} strokeWidth="3" /></>;
    case 'seal': { const c = form.outcome === 'unresolved' ? OUTCOME.failed : form.outcome === 'resolved' ? OUTCOME.solved : INTERFACE.text2, r = Math.min(w, h) / 2, cx = x + w / 2, cy = y + h / 2; return <><circle cx={cx} cy={cy} r={r} fill="var(--graphite)" stroke={c} strokeWidth="2" />{form.outcome === 'resolved' && <path d={`M${cx - r / 2} ${cy}l${r / 3} ${r / 3}l${r * 0.66} ${-r * 0.7}`} fill="none" stroke={c} strokeWidth="2.5" />}{form.outcome === 'unresolved' && <path d={`M${cx - r / 2.4} ${cy - r / 2.4}l${r * 0.83} ${r * 0.83}m0 ${-r * 0.83}l${-r * 0.83} ${r * 0.83}`} stroke={c} strokeWidth="2.5" />}</>; }
    case 'deck': return <rect x={x} y={y} width={w} height={h} rx="4" fill="rgba(23,26,29,.45)" stroke={SPECTRAL.blue} strokeOpacity="0.5" />;
    case 'record': return <><rect x={x} y={y} width={w} height={h} rx={h / 2} {...plate} /><circle cx={x + h / 2} cy={y + h / 2} r={h / 3.4} fill="none" stroke={OUTCOME.solved} strokeWidth="2" /></>;
    case 'stack': return <>{[8, 4, 0].map((d) => <rect key={d} x={x + d} y={y + 8 - d} width={w - 8} height={h - 8} rx="2" {...plate} />)}</>;
    case 'bytecode': return <><rect x={x + w * 0.62} y={y} width={w * 0.38} height={h} fill="none" stroke={SPECTRAL.blue} />{Array.from({ length: 12 }, (_, i) => <rect key={i} x={x + (i % 4) * (w * 0.14)} y={y + 4 + Math.floor(i / 4) * (h / 3.2)} width="6" height="6" fill={SPECTRAL.violet} fillOpacity="0.5" />)}</>;
    case 'limit': return <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2} fill="none" stroke={SPECTRAL.cyan} strokeDasharray="2 4" />;
    case 'cells': { const c = Math.min(form.cols, 7), r = Math.min(form.rows, 5), sw = w / c, sh = h / r; return <>{Array.from({ length: c * r }, (_, i) => <rect key={i} x={x + (i % c) * sw} y={y + Math.floor(i / c) * sh} width={sw - 2} height={sh - 2} fill={form.color} fillOpacity="0.72" />)}</>; }
    case 'tape': return <><rect x={x} y={y} width={w} height={h} rx="2" {...plate} /><Lines x={x + 6} y={y + 4} w={w - 12} h={h - 8} n={form.lines} color={OUTCOME.solved} /></>;
    case 'tally': return <><rect x={x} y={y} width={w} height={h} rx="2" {...plate} /><line x1={x + w / 2} x2={x + w / 2} y1={y + 3} y2={y + h - 3} stroke={INTERFACE.text} />{[[0.8, OUTCOME.solved], [0.4, OUTCOME.failed], [0.2, OUTCOME.mixed]].map(([l, c], i) => <rect key={i} x={x + w / 2 - (w / 2 - 6) * (l as number)} y={y + 6 + i * ((h - 8) / 3)} width={(w - 12) * (l as number)} height="5" fill={c as string} />)}</>;
    default: return null;
  }
}

/**
 * A story model in 2D, for phones, browsers without WebGL, and while the scene loads. It draws the same objects
 * as the 3D scene, in the model's own flat plan, with the objects of the current step at full strength.
 */
export function AssemblyFigure({ model, state, title }: { model: Model; state: number; title: string }) {
  const parts = model.parts.filter((p) => (p.poses[state]?.on ?? 0) > 0.5);
  const about = model.steps?.[state];
  const named = parts.filter((p: Part) => !p.inert);
  return (
    <svg className="story__figure" viewBox="0 0 640 400" role="img" aria-label={`${title} Shown: ${named.map((p) => p.title).join(', ')}.`}>
      {parts.map((p) => {
        const box = model.plan?.(p.id, state);
        if (!box) return null;
        return <g key={p.id} opacity={p.inert || !about || about.includes(p.id) ? 1 : 0.42}>{glyph(p.form, box, p.accent)}</g>;
      })}
    </svg>
  );
}
