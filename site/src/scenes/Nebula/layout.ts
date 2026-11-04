/**
 * Where the 77 bugs sit in the Nebula. Directions are evenly spread (a Fibonacci sphere) and assigned
 * by a seeded shuffle of the task order, so position is stable between visits but carries no meaning:
 * neighbours are not similar and distance says nothing. The page states this next to the figure.
 */
export function nebulaPositions(n: number, seed = 77): Float32Array {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const out = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  order.forEach((slot, bug) => {
    const y = 1 - ((slot + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * slot;
    const radius = 1.5 + rand() * 0.75;
    out[bug * 3] = Math.cos(theta) * r * radius;
    out[bug * 3 + 1] = y * radius;
    out[bug * 3 + 2] = Math.sin(theta) * r * radius;
  });
  return out;
}

/** The view that brings a point to the front: yaw about y, then pitch about x. */
export function viewToFront(x: number, y: number, z: number): { yaw: number; pitch: number } {
  return { yaw: -Math.atan2(x, z), pitch: Math.atan2(y, Math.hypot(x, z)) };
}
