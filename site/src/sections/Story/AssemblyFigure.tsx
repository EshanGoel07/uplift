import type { Model } from '../../state/assemblyStore';

/**
 * A story model in 2D, seen from the front: the same parts and the same poses as the 3D scene, for phones,
 * browsers without WebGL, and while the scene loads.
 */
export function AssemblyFigure({ model, state, title }: { model: Model; state: number; title: string }) {
  const parts = model.parts.filter((p) => (p.poses[state]?.on ?? 0) > 0.5);
  const xs = model.parts.flatMap((p) => p.poses.flatMap((q) => [q.p[0] - p.size[0] / 2, q.p[0] + p.size[0] / 2]));
  const ys = model.parts.flatMap((p) => p.poses.filter((q) => q.on > 0.5).flatMap((q) => [q.p[1] - p.size[1] / 2, q.p[1] + p.size[1] / 2]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = 640, H = 400, pad = 20;
  const sx = (W - pad * 2) / Math.max(0.1, x1 - x0), sy = (H - pad * 2) / Math.max(0.1, y1 - y0);
  return (
    <svg className="story__figure" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} Shown: ${parts.map((p) => p.title).join(', ')}.`}>
      {parts.map((p) => {
        const pose = p.poses[state];
        const w = p.size[0] * sx, h = Math.max(18, p.size[1] * sy);
        const x = pad + (pose.p[0] - p.size[0] / 2 - x0) * sx;
        const y = H - pad - (pose.p[1] - y0) * sy - h / 2;
        const lit = (pose.glow ?? 0) > 0.5;
        return (
          <g key={p.id}>
            <rect x={x} y={y} width={w} height={h} rx="4" fill="var(--graphite)" stroke={p.accent} strokeWidth={lit ? 2 : 1} opacity={lit ? 1 : 0.8} />
            <text x={x + 10} y={y + h / 2 + 4} fontSize="13" fill="var(--text)">{p.title}</text>
          </g>
        );
      })}
    </svg>
  );
}
