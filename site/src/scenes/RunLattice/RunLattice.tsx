import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedBufferAttribute, InstancedMesh, Object3D, PerspectiveCamera, PlaneGeometry, Quaternion, ShaderMaterial, Vector2, Vector3 } from 'three';
import { groupOf } from '../../data/classify';
import { atlas } from '../../state/atlasStore';
import { lattice, latticeHandlers, latticeLabels, latticeProbe, latticeScroll, useLattice } from '../../state/latticeStore';
import { requestFrame, scenes } from '../../state/sceneStore';
import { ADDITIVE, HALO_FALLOFF, hazeMaterial } from '../materials/shared';
import { CONDITION_COLOR, INTERFACE, OUTCOME } from '../palette';
import { LANE, REP, TILE_H, TILE_W, VISIBLE_H, VISIBLE_W, instanceIndex, latticeLayout, outcomeAt, type LatticeLayout, type Vec3 } from './layout';

/**
 * The run lattice: every one of the 924 runs as a point of light on one curved sheet in the Nebula's
 * atmosphere. A column is one bug, a row is one condition, a stacked pair is the two repeats, and colour
 * is the outcome. Each condition's identity is one fine filament along its row. The 23 mixed bugs burn
 * brighter than the rest, because they are the only bugs that can tell the setups apart.
 *
 * This is scene content only: it renders inside the one shared canvas through a StageView, so here
 * `useThree` reports the stage's size and the lattice's own camera. Nothing is written per frame at
 * rest. Matrices change only during the bounded build-in, and the camera fit and labels only when
 * the camera moved.
 *
 * After the build-in no instance data is uploaded at all. Outcomes are static attributes; hover, focus
 * and the design/outcomes view are per-bug uniform arrays read by the vertex shader. Writing instance
 * buffers after they had been drawn stalled the GPU process for 100-750 ms. Picking
 * uses the resting matrices.
 *
 * Two meshes share one geometry and one matrix buffer: the crisp tile, which takes the pointer, and a
 * wider soft halo that stands in for bloom, which cannot reach a StageView.
 */
const COLORS = {
  design: new Color(INTERFACE.text2),   // neutral warm grey: the design view, before outcomes
  solved: new Color(OUTCOME.solved),
  failed: new Color(OUTCOME.failed),
  focus: new Color(INTERFACE.ember),    // selection, never an outcome
};

/** The hover cursor, set on the stage only: cursor is inherited, so setting it on <body> restyles the page. */
const setCursor = (c: string): void => { const el = scenes.get('lattice').stage; if (el && el.style.cursor !== c) el.style.cursor = c; };

const BUILD_DELAY = 0.15, BUILD_STAGGER = 0.012, BUILD_LENGTH = 0.55;
/** Intensity of a bug whose twelve runs all agree, against a mixed bug at 1. */
const AGREED = 0.34;
const HALO_GROW = [3.6, 1.7] as const;
const SURFACE: Vector3 = new Vector3(0, 0, 1);

const tileVertex = (bugs: number) => /* glsl */ `
attribute float aBug;
attribute float aLane;
attribute float aRep;
attribute float aWeight;
attribute vec3 aOutcome;
attribute vec3 aDir;
uniform vec3 uIso;
uniform float uFade;
uniform vec2 uGrow;
uniform float uLift[${bugs}];
uniform float uDesign[${bugs}];
uniform float uGlow[${bugs}];
uniform vec3 uDesignColor;
varying vec2 vUv;
varying vec3 vColor;
varying float vStrength;
varying float vFocus;

void main() {
  int i = int(aBug + 0.5);
  float design = uDesign[i], lift = uLift[i], glow = uGlow[i];
  bool inside = (uIso.x < 0.0 || abs(aBug - uIso.x) < 0.5) && (uIso.y < 0.0 || abs(aLane - uIso.y) < 0.5) && (uIso.z < 0.0 || abs(aRep - uIso.z) < 0.5);
  float raised = smoothstep(0.0, 0.3, lift);
  float strength = mix(mix(aWeight, 0.46, design), 1.2, raised) + glow * 0.12;
  if (!inside) strength *= 1.0 - uFade;
  vUv = uv;
  vColor = mix(mix(aOutcome, uDesignColor, design), vec3(1.0), raised * 0.16);
  vStrength = strength;
  vFocus = glow;
  vec4 world = modelMatrix * instanceMatrix * vec4(position.xy * uGrow, 0.0, 1.0);
  world.xyz += aDir * lift + vec3(0.0, lift * 0.3, 0.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

/** A rounded tile with a brighter top edge, inset from its quad so neighbours stay apart. */
const TILE_FRAGMENT = /* glsl */ `
uniform vec3 uFocusColor;
varying vec2 vUv;
varying vec3 vColor;
varying float vStrength;
varying float vFocus;
void main() {
  vec2 q = abs(vUv - 0.5) * 2.0 / vec2(${VISIBLE_W.toFixed(4)}, ${VISIBLE_H.toFixed(4)});
  vec2 d = max(q - vec2(0.42, 0.56), 0.0) / vec2(0.34, 0.26);
  float edge = smoothstep(1.0, 0.8, length(d));
  float sheen = 0.78 + 0.32 * vUv.y;
  vec3 c = mix(vColor, uFocusColor, vFocus * 0.85) * sheen;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  float a = edge * vStrength;
  gl_FragColor = vec4(gl_FragColor.rgb * a, a);
}`;

const HALO_FRAGMENT = /* glsl */ `
${HALO_FALLOFF}
uniform vec3 uFocusColor;
varying vec2 vUv;
varying vec3 vColor;
varying float vStrength;
varying float vFocus;
void main() {
  float f = haloFalloff(length((vUv - 0.5) * 2.0));
  vec3 c = mix(vColor, uFocusColor, vFocus);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  float a = f * (0.1 * vStrength + 0.32 * vFocus);
  gl_FragColor = vec4(gl_FragColor.rgb * a, a);
}`;

/** One fine ribbon per condition along its row, in one geometry and one draw call. */
export function filamentGeometry(L: LatticeLayout, colors: Color[]): BufferGeometry {
  const SEGMENTS = 96, THICK = 0.016, LEAD = 2;
  const n = (SEGMENTS + 1) * 2 * L.lanes;
  const position = new Float32Array(n * 3), color = new Float32Array(n * 3), along = new Float32Array(n), lane = new Float32Array(n);
  const index: number[] = [];
  const p: Vec3 = [0, 0, 0];
  let v = 0;
  for (let r = 0; r < L.lanes; r++) {
    for (let s = 0; s <= SEGMENTS; s++) {
      const col = -LEAD + (s / SEGMENTS) * (L.columns - 1 + LEAD * 2);
      for (const side of [-1, 1]) {
        position.set(L.at(col, L.laneAt(r) + side * THICK, p), v * 3);
        colors[r].toArray(color, v * 3);
        along[v] = s / SEGMENTS;
        lane[v] = r;
        v++;
      }
      if (s < SEGMENTS) {
        const a = v - 2, b = v - 1, c = v, d = v + 1;
        index.push(a, b, c, b, d, c);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('aColor', new BufferAttribute(color, 3));
  g.setAttribute('aAlong', new BufferAttribute(along, 1));
  g.setAttribute('aLane', new BufferAttribute(lane, 1));
  g.setIndex(index);
  return g;
}

export function RunLatticeScene() {
  const tasks = useLattice((s) => s.tasks);
  const arms = useLattice((s) => s.arms);
  const mode = useLattice((s) => s.mode);
  const reduced = useLattice((s) => s.reduced);
  const mesh = useRef<InstancedMesh>(null);
  const halo = useRef<InstancedMesh>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const wide = size.width / Math.max(1, size.height) >= 0.95;

  const L = useMemo(() => latticeLayout(tasks, arms, wide), [tasks, arms, wide]);
  const { count, lanes, repeats, perBug, nTest, columns, laneAt, at, colAt } = L;

  // Everything an instance needs is static: which bug, lane and repeat it is, its real outcome, and how
  // bright its bug burns. Written once per data set, and read by both meshes.
  const geo = useMemo(() => {
    const g = new PlaneGeometry(1, 1);
    const bug = new Float32Array(count), lane = new Float32Array(count), rep = new Float32Array(count), weight = new Float32Array(count);
    const outcome = new Float32Array(count * 3);
    tasks.forEach((t, i) => {
      const w = groupOf(t.solved) === 'mixed' ? 1 : AGREED;
      arms.forEach((a, r) => {
        for (let q = 0; q < repeats; q++) {
          const n = instanceIndex(L, i, r, q);
          bug[n] = i; lane[n] = r; rep[n] = q; weight[n] = w;
          (outcomeAt(t, a.id, q) ? COLORS.solved : COLORS.failed).toArray(outcome, n * 3);
        }
      });
    });
    g.setAttribute('aBug', new InstancedBufferAttribute(bug, 1));
    g.setAttribute('aLane', new InstancedBufferAttribute(lane, 1));
    g.setAttribute('aRep', new InstancedBufferAttribute(rep, 1));
    g.setAttribute('aWeight', new InstancedBufferAttribute(weight, 1));
    g.setAttribute('aOutcome', new InstancedBufferAttribute(outcome, 3));
    g.setAttribute('aDir', new InstancedBufferAttribute(L.dir, 3));
    return g;
  }, [L, tasks, arms, count, repeats]);
  const filaments = useMemo(() => filamentGeometry(L, arms.map((a) => new Color(CONDITION_COLOR[a.id]))), [L, arms]);
  const hazePlane = useMemo(() => new PlaneGeometry(1, 1), []);
  useEffect(() => () => { geo.dispose(); filaments.dispose(); hazePlane.dispose(); }, [geo, filaments, hazePlane]);

  // Per-bug animation state, kept outside React so animation never re-renders. `lift`, `design` and
  // `glow` are the uniform arrays themselves: easing a value writes straight into what the shader reads.
  const st = useMemo(() => ({
    lift: new Float32Array(tasks.length),     // how far the bug has risen
    design: new Float32Array(tasks.length),   // 1 = neutral design colour, 0 = the run's real outcome
    glow: new Float32Array(tasks.length),     // 1 = the selected bug
    switchAt: new Float32Array(tasks.length),
    designTarget: 1,
    iso: new Vector3(-1, -1, -1),
    fade: { value: 0 },
    t0: -1,
    ready: false,
    built: false,
    colorBusy: false,
    matricesDirty: true,
    camDirty: true,
    el: 0,
  }), [tasks.length]);

  const materials = useMemo(() => {
    const shared = {
      uLift: { value: st.lift },
      uDesign: { value: st.design },
      uGlow: { value: st.glow },
      uDesignColor: { value: COLORS.design },
      uFocusColor: { value: COLORS.focus },
      uIso: { value: st.iso },
      uFade: st.fade,
    };
    const tile = (grow: readonly [number, number], fragmentShader: string) => new ShaderMaterial({
      ...ADDITIVE,
      depthTest: false,
      side: DoubleSide,
      uniforms: { ...shared, uGrow: { value: new Vector2(grow[0], grow[1]) } },
      vertexShader: tileVertex(st.lift.length),
      fragmentShader,
    });
    const filament = new ShaderMaterial({
      ...ADDITIVE,
      depthTest: false,
      side: DoubleSide,
      uniforms: { uIso: { value: st.iso }, uFade: st.fade },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aAlong;
        attribute float aLane;
        uniform vec3 uIso;
        uniform float uFade;
        varying vec3 vColor;
        varying float vA;
        void main() {
          bool inside = uIso.y < 0.0 || abs(aLane - uIso.y) < 0.5;
          float ends = smoothstep(0.0, 0.05, aAlong) * smoothstep(1.0, 0.92, aAlong);
          vA = ends * (0.5 + (inside ? 0.5 * uFade : -0.42 * uFade));
          vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vA;
        void main() {
          gl_FragColor = vec4(vColor, 1.0);
          #include <colorspace_fragment>
          gl_FragColor = vec4(gl_FragColor.rgb * vA, vA);
        }`,
    });
    return { tile: tile([1, 1], TILE_FRAGMENT), halo: tile(HALO_GROW, HALO_FRAGMENT), filament, haze: hazeMaterial({ seed: 3.7, intensity: 0.62, warmth: 0.4 }) };
  }, [st]);
  useEffect(() => () => { Object.values(materials).forEach((m) => m.dispose()); }, [materials]);

  // Scratch objects: no allocation inside the frame callback.
  const scratch = useMemo(() => ({ dummy: new Object3D(), v: new Vector3(), n: new Vector3(), q: new Quaternion(), p: [0, 0, 0] as Vec3 }), []);

  // The halo is the same instances: it draws from the tile's own matrix buffer, never a copy.
  useLayoutEffect(() => {
    if (mesh.current && halo.current) halo.current.instanceMatrix = mesh.current.instanceMatrix;
  });

  // The view: neutral in design mode, the real result in outcomes mode. Results sweep along the bugs.
  useEffect(() => {
    const now = performance.now() / 1000;
    st.designTarget = mode === 'design' ? 1 : 0;
    for (let i = 0; i < st.switchAt.length; i++) st.switchAt[i] = reduced ? 0 : now + i * 0.012;
    if (st.t0 < 0) st.design.fill(st.designTarget);
    st.colorBusy = true;
    requestFrame('state');
  }, [mode, reduced, st]);

  // Hover and focus change which bug lifts: wake the renderer for them.
  useEffect(() => {
    let { hovered, focus, isolateBug } = lattice.get();
    let { condition, repeat } = atlas.get();
    const a = lattice.subscribe(() => {
      const s = lattice.get();
      if (s.hovered !== hovered || s.focus !== focus || s.isolateBug !== isolateBug) { ({ hovered, focus, isolateBug } = s); requestFrame('state'); }
    });
    const b = atlas.subscribe(() => {
      const s = atlas.get();
      if (s.condition !== condition || s.repeat !== repeat) { ({ condition, repeat } = s); requestFrame('state'); }
    });
    return () => { a(); b(); };
  }, []);

  // New arrangement or size: write every matrix once and refit the camera.
  useEffect(() => {
    st.matricesDirty = true; st.camDirty = true;
    latticeLabels.forEach((el) => { if (el) el.dataset.orient = wide ? 'wide' : 'tall'; });
    requestFrame('resize');
  }, [wide, size.width, size.height, L, st]);

  useEffect(() => () => { setCursor(''); scenes.settle('lattice'); }, []);

  // QA only: where a bug's column sits on the stage, from its top tile's upper edge to its bottom
  // tile's lower edge, so a test can sweep every column exactly rather than guess at pixels.
  useEffect(() => {
    latticeProbe.column = (bug) => {
      const { v, p } = scratch;
      const point = (across: number) => {
        v.fromArray(at(colAt(bug), across, p)).project(camera);
        return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
      };
      return [point(laneAt(0) + REP * 2), point(laneAt(lanes - 1) - REP * 2)];
    };
    return () => { latticeProbe.column = null; };
  }, [at, camera, colAt, laneAt, lanes, scratch, size]);

  useFrame((_, dtRaw) => {
    const m = mesh.current;
    // Inactive: no work and no frame requests. Elapsed time simply lands on the settled state on return.
    if (!m || !scenes.isVisible('lattice')) { scenes.settle('lattice'); return; }
    const { hovered, focus: focused } = lattice.get();
    const dt = Math.min(dtRaw, 0.05);
    const now = performance.now() / 1000;
    if (st.t0 < 0) st.t0 = now;
    const since = now - st.t0;
    let busy = false;

    // Camera: a fixed three-quarter view of the sheet, rising a little as the hero scrolls away. It
    // never follows the pointer.
    const elT = (wide ? 0.24 : 0.1) + latticeScroll.value * 0.1;
    if (st.el === 0) { st.el = elT; st.camDirty = true; }
    if (Math.abs(elT - st.el) > 1e-4) {
      st.el += (elT - st.el) * (1 - Math.exp(-dt * 5));
      st.camDirty = true;
      busy = true;
    }

    if (st.camDirty) {
      st.camDirty = false;
      const { v, p } = scratch;
      const yaw = wide ? -0.12 : 0, R = 20;
      camera.position.set(Math.sin(yaw) * Math.cos(st.el) * R, Math.sin(st.el) * R, Math.cos(yaw) * Math.cos(st.el) * R);
      camera.lookAt(0, 0, -0.9);

      // Fit: project the sheet's outline and choose a view window that frames it, leaving room for the
      // condition names (left of the rows when wide, below them when tall).
      camera.clearViewOffset();
      camera.updateMatrixWorld();
      const halfV = (lanes * LANE) / 2;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let c = 0; c <= 8; c++) for (const s of [-1, 1]) {
        v.fromArray(at((c / 8) * (columns - 1), s * halfV, p)).project(camera);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      const W = size.width, H = size.height;
      const narrow = W < 640;
      const fx = !wide ? 0.94 : narrow ? 0.86 : 0.74, cxF = !wide ? 0.5 : narrow ? 0.54 : 0.615;
      const fy = wide ? 0.78 : 0.8, cyF = wide ? 0.52 : 0.44;
      const s = Math.min((2 * fx) / (x1 - x0), (2 * fy) / (y1 - y0));
      const w = W / s, h = H / s;
      const cxPx = (((x0 + x1) / 2 + 1) / 2) * W;
      const cyPx = ((1 - (y0 + y1) / 2) / 2) * H;
      camera.setViewOffset(W, H, cxPx - w * cxF, cyPx - h * cyF, w, h);

      // Project the DOM labels.
      const place = (node: HTMLElement | null | undefined, col: number, across: number) => {
        if (!node) return;
        v.fromArray(at(col, across, p)).project(camera);
        node.style.transform = `translate(${((v.x + 1) / 2) * W}px, ${((1 - v.y) / 2) * H}px)`;
        node.style.opacity = v.z < 1 ? '' : '0';
      };
      for (let r = 0; r < lanes; r++) {
        if (wide) place(latticeLabels[r], -2.4, laneAt(r)); else place(latticeLabels[r], columns + 1, laneAt(r));
      }
      const edge = laneAt(0) + LANE * 0.72;
      place(latticeLabels[lanes], colAt(0), edge);
      place(latticeLabels[lanes + 1], colAt(nTest), edge);
    }

    // Isolation: everything outside the chosen bug, condition and repeat recedes. Uniforms only.
    {
      const at0 = atlas.get(), lat = lattice.get();
      const lane = at0.condition ? arms.findIndex((a) => a.id === at0.condition) : -1;
      const rep = at0.repeat ?? -1, bug = lat.isolateBug ? focused : -1;
      if (lane >= 0 || rep >= 0 || bug >= 0) st.iso.set(bug, lane, rep);
      const want = lane >= 0 || rep >= 0 || bug >= 0 ? 0.9 : 0;
      const d = want - st.fade.value;
      if (Math.abs(d) > 2e-3) { st.fade.value = reduced ? want : st.fade.value + d * (1 - Math.exp(-dt * 9)); busy = true; } else st.fade.value = want;
    }

    const buildEnd = reduced ? 0 : BUILD_DELAY + (tasks.length - 1) * BUILD_STAGGER + BUILD_LENGTH;
    const building = since < buildEnd;
    // The last build-in frame stops just short of rest: write the settled state once.
    if (!building && !st.built) { st.built = true; st.matricesDirty = true; }

    /** Writes one bug's contiguous block of matrices. `e` is its build-in progress. */
    const writeBug = (i: number, e: number) => {
      const { dummy, n: normal, q } = scratch;
      for (let n = i * perBug, end = n + perBug; n < end; n++) {
        normal.fromArray(L.dir, n * 3);
        dummy.position.fromArray(L.pos, n * 3).addScaledVector(normal, (1 - e) * 1.6);
        dummy.quaternion.copy(q.setFromUnitVectors(SURFACE, normal));
        dummy.scale.set(TILE_W * (0.001 + e), TILE_H * (0.001 + e), 1);
        dummy.updateMatrix();
        m.setMatrixAt(n, dummy.matrix);
      }
    };

    // Lift and focus: the hovered or selected bug comes forward across all six rows at once, and the
    // selected bug carries an ember halo in either view. Only uniform arrays change.
    const glowRate = 1 - Math.exp(-dt * (reduced ? 1000 : 9));
    for (let i = 0; i < tasks.length; i++) {
      const glowWant = i === focused ? 1 : 0;
      const g = glowWant - st.glow[i];
      if (Math.abs(g) >= 1e-6) {
        if (Math.abs(g) > 2e-3) { st.glow[i] += g * glowRate; busy = true; } else st.glow[i] = glowWant;
      }
      const want = i === hovered ? 0.3 : i === focused ? 0.18 : 0;
      const d = want - st.lift[i];
      // Tolerance, not equality: lift is a Float32Array, so 0.18 never compares equal to itself as a double.
      if (Math.abs(d) < 1e-6) continue;
      if (Math.abs(d) > 1e-3) { st.lift[i] += d * (1 - Math.exp(-dt * 10)); busy = true; } else { st.lift[i] = want; }
    }

    if (building || st.matricesDirty) {
      // Build-in (bounded), or a new arrangement: every bug, once per frame while it lasts.
      for (let i = 0; i < tasks.length; i++) {
        const b = reduced ? 1 : Math.min(1, Math.max(0, (since - BUILD_DELAY - i * BUILD_STAGGER) / BUILD_LENGTH));
        writeBug(i, 1 - Math.pow(1 - b, 3));
      }
      m.instanceMatrix.needsUpdate = true;
      st.matricesDirty = false;
      if (building) busy = true;
      else m.computeBoundingSphere();
    }

    // The view: each bug eases between design and outcome colours after its turn in the sweep.
    if (st.colorBusy) {
      let pending = false;
      const a = 1 - Math.exp(-dt * (reduced ? 1000 : 9));
      for (let i = 0; i < st.design.length; i++) {
        if (now < st.switchAt[i]) { pending = true; continue; }
        const d = st.designTarget - st.design[i];
        if (d === 0) continue;
        if (Math.abs(d) > 2e-3) { st.design[i] += d * a; pending = true; } else st.design[i] = st.designTarget;
      }
      st.colorBusy = pending;
      if (pending) busy = true;
    }

    if (!st.ready) {
      if (!building) { st.ready = true; latticeHandlers.onReady(); } else busy = true;
    }
    if (busy) scenes.animate('lattice'); else scenes.settle('lattice');
  });

  const bugOf = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    e.instanceId === undefined ? null : Math.floor(e.instanceId / perBug);

  // Crossing from one tile to the next fires "out" for the old tile and then "move" for the new one, in
  // the same event. So the bug under the pointer is tracked here: the store only catches up after React
  // commits, and comparing with it would leave a bug cleared when two tiles belong to the same bug.
  const pointerBug = useRef<number | null>(null);
  const hover = (i: number | null) => {
    if (i === pointerBug.current) return;
    pointerBug.current = i;
    latticeHandlers.onHover(i);
  };

  return (
    <>
      <mesh geometry={hazePlane} material={materials.haze} position={[0, 0, -3.4]} scale={[21, 14, 1]} renderOrder={0} raycast={() => null} />
      <mesh geometry={filaments} material={materials.filament} renderOrder={1} raycast={() => null} />
      <instancedMesh ref={halo} args={[geo, materials.halo, count]} renderOrder={2} frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={mesh} args={[geo, materials.tile, count]} renderOrder={3}
        onPointerMove={(e) => { e.stopPropagation(); hover(bugOf(e)); setCursor('pointer'); }}
        onPointerOut={() => { hover(null); setCursor(''); }}
        onClick={(e) => { e.stopPropagation(); const i = bugOf(e); if (i !== null) latticeHandlers.onPick(i); }} />
    </>
  );
}
