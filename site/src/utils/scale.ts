/** Minimal linear scale (the only scale the charts need). */
export function scaleLinear(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain, [r0, r1] = range;
  const k = (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}
