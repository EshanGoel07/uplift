import type { Summary } from '../../data/types';

const W = 640, H = 400;
const BUG_X = 96, FORK_X = 470, TILE_X = 540, TOP = 42;

interface Props { stage: number; summary: Summary; title: string }

/**
 * The story in 2D, for phones, for browsers without WebGL, and while the 3D scene loads. It draws the same
 * five states from the study's real dimensions. Paths reveal through CSS, which reduced motion turns off.
 */
export function StoryFigure({ stage, summary, title }: Props) {
  const arms = summary.arms;
  const pitch = (H - TOP * 2) / (arms.length - 1);
  const y = (r: number) => TOP + r * pitch;

  if (stage >= 3) {
    const bugs = summary.tasks.length;
    const fresh = summary.tasks.filter((t) => t.set === 'fresh').length;
    const gap = 3;
    const col = (W - 40) / (bugs + gap);
    const left = 20;
    const focus = bugs - fresh + 11 + gap;       // the story's bug, within the fresh bugs
    const bend = (x: number) => Math.sin((x / W) * Math.PI) * 18;
    return (
      <svg className={`story__figure sf sf--${stage}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <defs>
          <radialGradient id="sf-haze"><stop offset="0" stopColor="var(--cond-both)" stopOpacity="0.28" /><stop offset="1" stopColor="var(--cond-both)" stopOpacity="0" /></radialGradient>
        </defs>
        <ellipse cx={W / 2} cy={H / 2} rx={W / 2} ry={H / 2} fill="url(#sf-haze)" />
        {arms.map((a, r) => (
          <g key={a.id}>
            {Array.from({ length: bugs + gap }, (_, c) => {
              const inGap = c >= bugs - fresh && c < bugs - fresh + gap;
              if (inGap) return null;
              const x = left + c * col;
              const on = c === focus;
              return [-1, 1].map((q) => (
                <rect key={`${c}${q}`} x={x} y={y(r) + bend(x) + q * 8 - 6} width={col * 0.68} height="12" rx="1.5"
                      fill={on ? 'var(--ember)' : 'var(--text-2)'} opacity={on ? 1 : stage === 4 ? 0.72 : 0.38} />
              ));
            })}
            <path d={`M${left} ${y(r) + 1} Q ${W / 2} ${y(r) + 37} ${W - 20} ${y(r) + 1}`} fill="none" style={{ stroke: `var(--cond-${a.id})` }} strokeWidth="1.5" opacity={stage === 4 ? 0.9 : 0.5} />
          </g>
        ))}
      </svg>
    );
  }

  const cy = H / 2;
  return (
    <svg className={`story__figure sf sf--${stage}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
      <defs>
        <radialGradient id="sf-glow"><stop offset="0" stopColor="var(--cond-tuned)" stopOpacity="0.7" /><stop offset="0.5" stopColor="var(--cond-handwritten)" stopOpacity="0.22" /><stop offset="1" stopColor="var(--cond-both)" stopOpacity="0" /></radialGradient>
      </defs>
      <circle cx={BUG_X} cy={cy} r="88" fill="url(#sf-glow)" />
      {stage >= 1 && arms.map((a, r) => (
        <g key={a.id} style={{ color: `var(--cond-${a.id})` }}>
          <path className="sf__path" pathLength={1} style={{ animationDelay: `${r * 90}ms` }} d={`M${BUG_X} ${cy} C ${BUG_X + 170} ${cy}, ${FORK_X - 160} ${y(r)}, ${FORK_X} ${y(r)}`} fill="none" stroke="currentColor" strokeWidth="3" />
          {stage >= 2 && [-1, 1].map((q) => (
            <g key={q}>
              <path className="sf__path" pathLength={1} d={`M${FORK_X} ${y(r)} C ${FORK_X + 30} ${y(r)}, ${TILE_X - 30} ${y(r) + q * 11}, ${TILE_X} ${y(r) + q * 11}`} fill="none" stroke="currentColor" strokeWidth="2" />
              <rect x={TILE_X} y={y(r) + q * 11 - 8} width="44" height="16" rx="3" fill="var(--ember)" />
            </g>
          ))}
        </g>
      ))}
      <circle cx={BUG_X} cy={cy} r="20" fill="var(--cond-none)" />
      <circle cx={BUG_X} cy={cy} r="44" fill="none" stroke="var(--ember)" strokeWidth="1.5" />
    </svg>
  );
}
