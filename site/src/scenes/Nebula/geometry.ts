import { BufferAttribute, BufferGeometry } from 'three';
import { rng } from '../random';

/**
 * An open, ragged spherical shell: unit-sphere directions from the pole (phi = 0) out to a rim whose
 * opening varies with theta. Returns a triangle geometry (faint fill) and a line geometry (a dense
 * triangulated wireframe: rings, meridians and one diagonal per quad) that share the same vertices.
 */
export function makeShell(segTheta: number, segPhi: number, phiMax: number, seed: number) {
  const rand = rng(seed);
  const k1 = 2 + Math.floor(rand() * 3), k2 = 5 + Math.floor(rand() * 4);
  const o1 = rand() * Math.PI * 2, o2 = rand() * Math.PI * 2;
  const cols = segTheta, rows = segPhi + 1;
  const pos = new Float32Array(cols * rows * 3);
  const rim = new Float32Array(cols * rows);
  const seedAttr = new Float32Array(cols * rows);

  for (let i = 0; i < cols; i++) {
    const theta = (i / cols) * Math.PI * 2;
    const open = phiMax * (1 + 0.13 * Math.sin(k1 * theta + o1) + 0.07 * Math.sin(k2 * theta + o2));
    for (let j = 0; j < rows; j++) {
      const v = j / segPhi;
      const phi = v * open;
      const idx = i * rows + j;
      pos[idx * 3] = Math.sin(phi) * Math.cos(theta);
      pos[idx * 3 + 1] = Math.sin(phi) * Math.sin(theta);
      pos[idx * 3 + 2] = -Math.cos(phi);
      rim[idx] = v;
      seedAttr[idx] = rand();
    }
  }

  const tris: number[] = [];
  const lines: number[] = [];
  for (let i = 0; i < cols; i++) {
    const ni = (i + 1) % cols;
    for (let j = 0; j < rows - 1; j++) {
      const a = i * rows + j, b = ni * rows + j, c = i * rows + j + 1, d = ni * rows + j + 1;
      tris.push(a, b, c, b, d, c);
      lines.push(a, c);            // meridian
      if (j > 0) lines.push(a, b); // ring
      lines.push(b, c);            // diagonal: gives the triangulated look
    }
    const last = i * rows + rows - 1;
    lines.push(last, ni * rows + rows - 1); // rim
  }

  const mk = (index: number[]) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aRim', new BufferAttribute(rim, 1));
    g.setAttribute('aSeed', new BufferAttribute(seedAttr, 1));
    g.setIndex(index);
    g.computeBoundingSphere();
    g.boundingSphere!.radius = 3.5;
    return g;
  };
  return { fill: mk(tris), wire: mk(lines) };
}

/** Curved luminous strands from the core outwards, as line segments with a 0..1 parameter. */
export function makeStrands(count: number, segs: number, seed: number) {
  const rand = rng(seed);
  const pos: number[] = [], t: number[] = [], sd: number[] = [];
  for (let s = 0; s < count; s++) {
    // direction biased toward the shell's back hemisphere (where the membranes are)
    const u = rand() * 2 - 1, th = rand() * Math.PI * 2;
    const r0 = Math.sqrt(1 - u * u);
    const dir = [r0 * Math.cos(th), r0 * Math.sin(th), -Math.abs(u) * 0.8 - 0.1];
    const len = 1.0 + rand() * 1.1;
    const bend = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
    const sv = rand();
    let prev: number[] | null = null;
    for (let k = 0; k <= segs; k++) {
      const a = k / segs;
      const r = 0.55 + a * len;
      const curl = Math.sin(a * Math.PI) * 0.55;
      const p = [dir[0] * r + bend[0] * curl, dir[1] * r + bend[1] * curl, dir[2] * r + bend[2] * curl];
      if (prev) {
        pos.push(...prev, ...p);
        t.push(a - 1 / segs, a);
        sd.push(sv, sv);
      }
      prev = p;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aT', new BufferAttribute(new Float32Array(t), 1));
  g.setAttribute('aSeed', new BufferAttribute(new Float32Array(sd), 1));
  g.computeBoundingSphere();
  return g;
}

/** Dust inside and around the shell, plus a sparse far starfield. */
export function makeDust(inner: number, far: number, seed: number) {
  const rand = rng(seed);
  const n = inner + far;
  const pos = new Float32Array(n * 3), size = new Float32Array(n), sd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = rand() * 2 - 1, th = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const r = i < inner ? 0.8 + Math.pow(rand(), 0.7) * 1.9 : 7 + rand() * 9;
    pos[i * 3] = s * Math.cos(th) * r * (i < inner ? 1 : 1.8);
    pos[i * 3 + 1] = s * Math.sin(th) * r;
    pos[i * 3 + 2] = i < inner ? u * r : -Math.abs(u * r) - 2;
    size[i] = i < inner ? 0.6 + rand() * 1.6 : 0.4 + rand() * 1.1;
    sd[i] = rand();
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aSize', new BufferAttribute(size, 1));
  g.setAttribute('aSeed', new BufferAttribute(sd, 1));
  g.computeBoundingSphere();
  g.boundingSphere!.radius = 30;
  return g;
}
