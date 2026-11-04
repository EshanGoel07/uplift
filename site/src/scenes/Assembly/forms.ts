import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, EdgesGeometry, Euler, ExtrudeGeometry, Float32BufferAttribute, IcosahedronGeometry, Matrix4, PlaneGeometry, Quaternion, Shape, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import tree from '../../data/repoTree.json';
import { repoLayout, type RepoFile } from '../../data/repoLayout';
import { DIFF_PITCH, LINE_PITCH, sheetDepth, type Form, type Part, type Stroke } from '../../state/assemblyStore';
import { INTERFACE, OUTCOME, SPECTRAL } from '../colors';

// The story models' geometry. Each form is what its object is: a repository is its real file tree, a document
// has its real number of lines, a diff has its real additions and removals. Every builder merges into one
// geometry, so a part costs one draw for its surfaces and one for its lit edges.

type Ink = [string, number];
interface Opts { m?: Matrix4; ink?: Ink; gate?: [number, number]; edged?: boolean }
interface Built { body: BufferGeometry; edges: BufferGeometry | null }

const scratch = new Color();
const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Matrix4 =>
  new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(1, 1, 1));

class Kit {
  private pos: number[] = [];
  private nor: number[] = [];
  private ink: number[] = [];
  private gate: number[] = [];
  private edged: number[] = [];

  add(source: BufferGeometry, o: Opts = {}): this {
    const g = source.index ? source.toNonIndexed() : source;
    if (o.m) g.applyMatrix4(o.m);
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const [c, a] = o.ink ?? [INTERFACE.obsidian, 0];
    scratch.set(c);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.ink.push(scratch.r, scratch.g, scratch.b, a);
      this.gate.push(o.gate?.[0] ?? 0, o.gate?.[1] ?? 0);
      if (o.edged) this.edged.push(p.getX(i), p.getY(i), p.getZ(i));
    }
    if (g !== source) g.dispose();
    source.dispose();
    return this;
  }
  box(x: number, y: number, z: number, w: number, h: number, d: number, o: Opts = {}): this {
    return this.add(new BoxGeometry(w, h, d), { ...o, m: at(x, y, z) });
  }
  /** A flat lit shape on an upward face. */
  quad(x: number, y: number, z: number, w: number, d: number, o: Opts = {}): this {
    return this.add(new PlaneGeometry(w, d), { ...o, m: at(x, y, z, -Math.PI / 2) });
  }
  /** A thin bar between two points on a plane. */
  bar(x0: number, z0: number, x1: number, z1: number, y: number, t: number, o: Opts = {}): this {
    const len = Math.hypot(x1 - x0, z1 - z0);
    return this.add(new BoxGeometry(len, t, t), { ...o, m: at((x0 + x1) / 2, y, (z0 + z1) / 2, 0, -Math.atan2(z1 - z0, x1 - x0)) });
  }
  done(): Built {
    const body = new BufferGeometry();
    body.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    body.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    body.setAttribute('aInk', new BufferAttribute(new Float32Array(this.ink), 4));
    body.setAttribute('aGate', new BufferAttribute(new Float32Array(this.gate), 2));
    let edges: BufferGeometry | null = null;
    if (this.edged.length) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(this.edged, 3));
      edges = new EdgesGeometry(g, 32);
      g.dispose();
    }
    return { body, edges };
  }
}

/** A plate from an outline in the XZ plane, top face at +h/2. */
function plate(outline: (s: Shape) => void, h: number): BufferGeometry {
  const s = new Shape();
  outline(s);
  const bevel = Math.min(0.012, h / 4);
  const g = new ExtrudeGeometry(s, { depth: Math.max(0.005, h - bevel * 2), bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 8 });
  g.rotateX(Math.PI / 2);
  g.translate(0, h / 2 - bevel, 0);
  return g;
}

function rounded(s: Shape, w: number, d: number, r: number) {
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
}

const TONE: Record<NonNullable<Stroke['tone']>, Ink> = {
  plain: [INTERFACE.text2, 0.62], code: [SPECTRAL.amber, 0.72], head: [INTERFACE.text, 0.95],
  add: [OUTCOME.solved, 1.05], del: [OUTCOME.failed, 1.05], hunk: [SPECTRAL.cyan, 0.42],
};

function repo(f: Extract<Form, { kind: 'repo' }>): Built {
  const k = new Kit();
  const { tiles, trays } = repoLayout(tree.files as RepoFile[], f.width, f.depth);
  k.box(0, -0.13, 0, f.width + 0.14, 0.26, f.depth + 0.14, { edged: true });
  for (const t of trays) k.box(t.x + t.w / 2, t.level === 0 ? 0.03 : 0.07, t.z + t.d / 2, t.w - 0.012, 0.05, t.d - 0.012, { edged: true });
  const lit = new Map(f.lit.map((l) => [l.path, l]));
  const tall = (b: number) => 0.05 + 0.1 * Math.max(0, Math.log10(b / 300));
  for (const t of tiles) {
    const h = tall(t.bytes), base = t.level === 0 ? 0 : t.level === 1 ? 0.055 : 0.095;
    const cx = t.x + t.w / 2, cz = t.z + t.d / 2, top = base + h;
    k.box(cx, base + h / 2, cz, t.w, h, t.d);
    k.quad(cx, top + 0.001, cz, t.w * 0.94, t.d * 0.94, { ink: [t.path.startsWith('tests/') ? SPECTRAL.cyan : SPECTRAL.blue, 0.02 + Math.min(0.05, h * 0.2)] });
    if (f.scan && t.path.startsWith('tests/')) k.quad(cx, top + 0.002, cz, t.w * 0.94, t.d * 0.94, { ink: [SPECTRAL.cyan, 0.26], gate: [0.72 + 0.27 * ((cx + f.width / 2) / f.width), 0] });
    const l = lit.get(t.path);
    if (l) k.quad(cx, top + 0.003, cz, t.w * 0.98, t.d * 0.98, { ink: [l.color, 1.6], gate: [l.seq, 0] });
  }
  return k.done();
}

function sheet(f: Extract<Form, { kind: 'sheet' }>): Built {
  const k = new Kit();
  const w = f.width, d = sheetDepth(f.lines.length), h = 0.07, top = h / 2 + 0.002;
  if (f.shape === 'ticket') {
    k.add(plate((s) => {
      const x = -w / 2, y = -d / 2, n = 0.09, c = 0.46;
      s.moveTo(x, y); s.lineTo(x + w, y); s.lineTo(x + w, y + c - n);
      s.absarc(x + w, y + c, n, -Math.PI / 2, Math.PI / 2, true);
      s.lineTo(x + w, y + d); s.lineTo(x, y + d); s.lineTo(x, y + c + n);
      s.absarc(x, y + c, n, Math.PI / 2, -Math.PI / 2, true);
      s.lineTo(x, y);
    }, h), { edged: true });
    // The issue's header: an open-status dot and a title, cut off from the body by a perforation.
    k.add(new CylinderGeometry(0.075, 0.075, 0.012, 20), { m: at(-w / 2 + 0.26, top, -d / 2 + 0.24), ink: [OUTCOME.solved, 1] });
    k.quad(0.1, top, -d / 2 + 0.24, w - 0.92, 0.075, { ink: [INTERFACE.text, 0.9] });
    for (let x = -w / 2 + 0.2; x < w / 2 - 0.12; x += 0.13) k.quad(x, top, -d / 2 + 0.46, 0.06, 0.012, { ink: [INTERFACE.text3, 0.7] });
  } else {
    const c = 0.3;
    k.add(plate((s) => {
      const x = -w / 2, y = -d / 2;
      s.moveTo(x, y); s.lineTo(x + w, y); s.lineTo(x + w, y + d - c); s.lineTo(x + w - c, y + d); s.lineTo(x, y + d); s.lineTo(x, y);
    }, h), { edged: true });
    // The heading mark, and the corner folded over.
    for (const z of [-0.035, 0.035]) k.quad(-w / 2 + 0.3, top, -d / 2 + 0.25 + z, 0.2, 0.022, { ink: [f.color, 1.2] });
    for (const x of [-0.04, 0.04]) k.quad(-w / 2 + 0.3 + x, top, -d / 2 + 0.25, 0.022, 0.2, { ink: [f.color, 1.2] });
    k.bar(w / 2 - c, -d / 2, w / 2, -d / 2 + c, top + 0.02, 0.018, {});
  }
  const left = -w / 2 + 0.2, span = w - 0.4, z0 = -d / 2 + (f.shape === 'ticket' ? 0.56 : 0.5);
  f.lines.forEach((l, i) => {
    if (l.len <= 0) return;
    const indent = l.tone === 'code' ? 0.08 : 0;
    const len = Math.max(0.05, l.len * (span - indent));
    k.quad(left + indent + len / 2, top, z0 + i * LINE_PITCH, len, 0.03, { ink: l.tone === 'head' ? [f.color, 1.1] : TONE[l.tone ?? 'plain'] });
  });
  return k.done();
}

/** A sheet that is no longer there: only its dashed outline remains. */
function ghost(f: Extract<Form, { kind: 'ghost' }>): Built {
  const k = new Kit();
  const w = f.width / 2, d = f.depth / 2, dash = 0.13, step = 0.23, t = 0.02;
  for (let x = -w; x < w - 0.04; x += step) for (const z of [-d, d]) k.quad(x + dash / 2, 0, z, dash, t, { ink: [f.color, 0.9] });
  for (let z = -d; z < d - 0.04; z += step) for (const x of [-w, w]) k.quad(x, 0, z + dash / 2, t, dash, { ink: [f.color, 0.9] });
  const c = 0.2;
  k.bar(-c, -c, c, c, 0, 0.03, { ink: [f.color, 0.9] });
  k.bar(-c, c, c, -c, 0, 0.03, { ink: [f.color, 0.9] });
  return k.done();
}

/** The workspace's single commit, and the chain behind it cut away. */
function commit(f: Extract<Form, { kind: 'commit' }>): Built {
  const k = new Kit();
  k.add(new TorusGeometry(0.24, 0.05, 12, 40), { m: at(0, 0, 0, Math.PI / 2), ink: [f.color, 0.9] });
  k.add(new CylinderGeometry(0.1, 0.1, 0.06, 24), { ink: [INTERFACE.text, 0.7] });
  k.box(-0.46, 0, 0, 0.2, 0.035, 0.035, { ink: [f.color, 0.75] });
  for (const [x, a] of [[-1.04, 0.42], [-1.5, 0.22]] as const) {
    k.add(new TorusGeometry(0.15, 0.016, 8, 32), { m: at(x, 0, 0, Math.PI / 2), ink: [INTERFACE.text3, a * 1.4] });
    k.box(x - 0.27, 0, 0, 0.14, 0.012, 0.012, { ink: [INTERFACE.text3, a] });
  }
  return k.done();
}

/** Events the agent's work raises, wired to the checks they run. Co-change is a linked pair; verify can stop the agent, so it is a stop-shaped nut. */
function hooks(f: Extract<Form, { kind: 'hooks' }>): Built {
  const k = new Kit();
  const edit = -0.5, stop = 0.82, ex = -1.15, cx = 0.75;
  const has = (c: string) => f.checks.includes(c);
  const puck = (z: number) => {
    k.add(new CylinderGeometry(0.34, 0.38, 0.14, 40), { m: at(ex, 0, z), edged: true });
    k.add(new CylinderGeometry(0.16, 0.16, 0.02, 28), { m: at(ex, 0.08, z), ink: [f.color, 1.1] });
    k.bar(-1.9, z, ex - 0.36, z, 0, 0.025, { ink: [f.color, 0.8] });
  };
  if (has('lint') || has('cochange')) puck(edit);
  if (has('verify')) puck(stop);
  const wire = (z0: number, z1: number) => {
    k.bar(ex + 0.36, z0, -0.2, z0, 0, 0.022, { ink: [f.color, 0.8] });
    k.bar(-0.2, z0, -0.2, z1, 0, 0.022, { ink: [f.color, 0.8] });
    k.bar(-0.2, z1, cx - 0.3, z1, 0, 0.022, { ink: [f.color, 0.8] });
  };
  if (has('lint')) {
    const z = has('cochange') ? edit - 0.42 : edit;
    wire(edit, z);
    k.box(cx + 0.12, 0, z, 0.86, 0.16, 0.3, { edged: true });
    for (let i = 0; i < 7; i++) k.quad(cx - 0.2 + i * 0.1, 0.082, z, 0.03, 0.16, { ink: [f.color, 0.75 + (i % 3) * 0.2] });
  }
  if (has('cochange')) {
    const z = edit + 0.34;
    wire(edit, z);
    for (const x of [cx - 0.08, cx + 0.42]) {
      k.add(new CylinderGeometry(0.16, 0.16, 0.16, 28), { m: at(x, 0, z), edged: true });
      k.add(new CylinderGeometry(0.07, 0.07, 0.02, 20), { m: at(x, 0.09, z), ink: [f.color, 1] });
    }
    k.box(cx + 0.17, 0.04, z, 0.36, 0.03, 0.05, { ink: [f.color, 0.9] });
  }
  if (has('verify')) {
    wire(stop, stop);
    k.add(new CylinderGeometry(0.36, 0.36, 0.18, 6), { m: at(cx + 0.14, 0, stop, 0, Math.PI / 6), edged: true });
    k.box(cx + 0.14, 0.1, stop, 0.34, 0.015, 0.08, { ink: [f.color, 1.2] });
  }
  return k.done();
}

/** The execution core: a source of light inside a shell of plates. One ring carries forty ticks, the run's limit of model steps. */
function core(): Built {
  const k = new Kit();
  k.add(new SphereGeometry(0.42, 32, 24), { ink: [SPECTRAL.core, 1.7] });
  const shell = new IcosahedronGeometry(0.66, 1);
  const p = shell.getAttribute('position');
  const v = [new Vector3(), new Vector3(), new Vector3()], mid = new Vector3(), plates: number[] = [];
  for (let i = 0; i < p.count; i += 3) {
    v.forEach((u, j) => u.fromBufferAttribute(p, i + j));
    mid.copy(v[0]).add(v[1]).add(v[2]).divideScalar(3);
    for (const u of v) { u.lerp(mid, 0.14); plates.push(u.x, u.y, u.z); }
  }
  shell.dispose();
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(plates, 3));
  g.computeVertexNormals();
  k.add(g, { edged: true });
  k.add(new TorusGeometry(1.04, 0.022, 12, 120), { m: at(0, 0, 0, Math.PI / 2 + 0.34, 0, 0.2), ink: [SPECTRAL.amber, 1.1] });
  const r = 1.34, ring = at(0, 0, 0, Math.PI / 2 - 0.5, 0, -0.3);
  k.add(new TorusGeometry(r, 0.012, 8, 120), { m: ring, ink: [SPECTRAL.amber, 0.7] });
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2, major = i % 10 === 0;
    k.add(new BoxGeometry(major ? 0.13 : 0.08, 0.022, 0.014), { m: ring.clone().multiply(at(Math.cos(a) * (r + 0.05), Math.sin(a) * (r + 0.05), 0, 0, 0, a)), ink: [SPECTRAL.core, major ? 1.3 : 0.8] });
  }
  return k.done();
}

/** A patch: a gutter, then its real lines in their real order, additions and removals in their colours. */
function diff(f: Extract<Form, { kind: 'diff' }>): Built {
  const k = new Kit();
  const n = f.lines.length, w = f.width, d = 0.36 + n * DIFF_PITCH, h = 0.1, top = h / 2 + 0.002;
  k.add(plate((s) => rounded(s, w, d, 0.07), h), { edged: true });
  k.quad(-w / 2 + 0.17, top, 0, 0.2, d - 0.1, { ink: [INTERFACE.text3, 0.06] });
  const left = -w / 2 + 0.36, span = w - 0.56, z0 = -d / 2 + 0.18 + DIFF_PITCH / 2;
  f.lines.forEach((l, i) => {
    if (l.len <= 0) return;
    const tone = TONE[l.tone ?? 'plain'], z = z0 + i * DIFF_PITCH;
    if (l.tone === 'add' || l.tone === 'del') {
      k.quad(0.1, top - 0.0006, z, w - 0.3, DIFF_PITCH * 0.92, { ink: [tone[0], 0.09] });
      k.quad(-w / 2 + 0.17, top, z, 0.09, 0.022, { ink: [tone[0], 1.2] });
      if (l.tone === 'add') k.quad(-w / 2 + 0.17, top, z, 0.022, 0.09, { ink: [tone[0], 1.2] });
    }
    const len = Math.max(0.04, l.len * span);
    k.quad(left + len / 2, top, z, len, 0.028, { ink: tone });
  });
  return k.done();
}

function spine(f: Extract<Form, { kind: 'spine' }>): Built {
  const k = new Kit();
  const stops = [SPECTRAL.blue, SPECTRAL.violet, SPECTRAL.magenta, SPECTRAL.amber], n = 16;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    k.box(0, -f.height / 2 + (t + 0.5 / n) * f.height, 0, 0.018, (f.height / n) * 0.94, 0.018, { ink: [stops[Math.floor(t * stops.length)], 0.7] });
  }
  return k.done();
}

/** A section cut through one workspace: floor, back wall, and the cut ends of its structure. There is only ever one room. */
function room(f: Extract<Form, { kind: 'room' }>): Built {
  const k = new Kit();
  const { width: w, depth: d, height: h } = f, t = 0.16, back = -d / 2 + t / 2;
  k.box(0, -t / 2, 0, w, t, d, { edged: true });
  k.box(0, h / 2, back, w, h, t, { edged: true });
  k.box(-w / 2 + t / 2, h * 0.24, -d * 0.2, t, h * 0.48, d * 0.6, { edged: true });
  k.box(w / 2 - t, h / 2, back + t, t * 2, h, t * 2, { edged: true });
  k.box(0, h - t / 2, back + 0.5, w, t, 1, { edged: true });
  for (let x = -w / 2 + 1; x < w / 2; x += 1) k.quad(x, 0.002, 0, 0.012, d - 0.1, { ink: [INTERFACE.text3, 0.1] });
  for (let z = -d / 2 + 1; z < d / 2; z += 1) k.quad(0, 0.002, z, w - 0.1, 0.012, { ink: [INTERFACE.text3, 0.1] });
  return k.done();
}

/** Time, left to right. Warm while the agent can run; cool from the moment it has exited. */
function rail(f: Extract<Form, { kind: 'rail' }>): Built {
  const k = new Kit();
  const x0 = f.ticks[0], x1 = f.ticks[f.ticks.length - 1], top = 0.05;
  k.box((x0 + x1) / 2, 0, 0, x1 - x0 + 1, 0.08, 0.26, { edged: true });
  k.quad((x0 + f.split) / 2, top, 0, f.split - x0, 0.03, { ink: [SPECTRAL.amber, 1.1] });
  k.quad((f.split + x1) / 2, top, 0, x1 - f.split, 0.03, { ink: [SPECTRAL.cyan, 0.9] });
  f.ticks.forEach((x) => {
    const major = x === f.split;
    k.box(x, 0.06, 0, major ? 0.05 : 0.03, major ? 0.2 : 0.12, major ? 0.3 : 0.2, { ink: [major ? INTERFACE.text : INTERFACE.text2, 0.9] });
  });
  return k.done();
}

function marker(): Built {
  const k = new Kit();
  k.add(new CylinderGeometry(0.15, 0, 0.26, 3), { ink: [INTERFACE.ember, 1.4] });
  return k.done();
}

/** The hidden test patch: closed by a band until it is applied, its own added lines inside. */
function sealed(f: Extract<Form, { kind: 'sealed' }>): Built {
  const k = new Kit();
  const w = 1.5, d = 1.1, h = 0.3, top = h / 2 + 0.003;
  k.add(plate((s) => rounded(s, w, d, 0.08), h), { edged: true });
  for (let i = 0; i < 7; i++) k.quad(-0.16 + ((i * 3) % 5) * 0.03, top, -0.36 + i * 0.12, 0.72 + ((i * 3) % 5) * 0.09, 0.03, { ink: [f.color, 1.1], gate: [0.5, 0] });
  k.quad(0, top + 0.001, 0, 0.3, d, { ink: [SPECTRAL.violet, 1.1], gate: [-0.5, 0] });
  k.quad(0, top + 0.002, 0, w, 0.16, { ink: [SPECTRAL.violet, 1.1], gate: [-0.5, 0] });
  return k.done();
}

/** Where pytest has reached: one line across the repository. */
function scan(f: Extract<Form, { kind: 'scan' }>): Built {
  const k = new Kit();
  k.box(0, 0, 0, 0.03, 0.03, f.depth, { ink: [SPECTRAL.cyan, 1.5] });
    return k.done();
}

/** The recorded outcome, a closed ring with a mark that means only one thing. */
function seal(f: Extract<Form, { kind: 'seal' }>): Built {
  const k = new Kit();
  const c = f.outcome === 'unresolved' ? OUTCOME.failed : f.outcome === 'resolved' ? OUTCOME.solved : INTERFACE.text2, top = 0.07;
  k.add(new CylinderGeometry(0.72, 0.72, 0.1, 64), { edged: true });
  k.add(new TorusGeometry(0.72, 0.024, 10, 96), { m: at(0, 0.03, 0, Math.PI / 2), ink: [c, 1.3] });
  if (f.outcome === 'resolved') {
    k.bar(-0.3, 0.02, -0.08, 0.26, top, 0.05, { ink: [c, 1.5] });
    k.bar(-0.08, 0.26, 0.34, -0.26, top, 0.05, { ink: [c, 1.5] });
  } else if (f.outcome === 'unresolved') {
    k.bar(-0.26, -0.26, 0.26, 0.26, top, 0.05, { ink: [c, 1.5] });
    k.bar(-0.26, 0.26, 0.26, -0.26, top, 0.05, { ink: [c, 1.5] });
  }
  return k.done();
}

function solid(p: Part): Built {
  const k = new Kit();
  const [w, h, d] = p.size;
  if (p.shape === 'column') return k.add(new CylinderGeometry(w / 2, w / 2, h, 40, 1), { edged: true }).done();
  if (p.shape === 'wall') return k.add(new BoxGeometry(w, h, d), { edged: true }).done();
  return k.add(plate((s) => rounded(s, w, d, Math.min(0.14, Math.min(w, d) / 5)), h), { edged: true }).done();
}

export function buildForm(p: Part): Built {
  const f = p.form;
  if (!f) return solid(p);
  switch (f.kind) {
    case 'repo': return repo(f);
    case 'sheet': return sheet(f);
    case 'ghost': return ghost(f);
    case 'commit': return commit(f);
    case 'hooks': return hooks(f);
    case 'core': return core();
    case 'diff': return diff(f);
    case 'spine': return spine(f);
    case 'room': return room(f);
    case 'rail': return rail(f);
    case 'marker': return marker();
    case 'sealed': return sealed(f);
    case 'scan': return scan(f);
    case 'seal': return seal(f);
  }
}
