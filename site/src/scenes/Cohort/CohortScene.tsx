import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, type BufferGeometry, Color, CubicBezierCurve3, DoubleSide, type Group, InstancedBufferAttribute, type InstancedMesh, type Mesh, MeshBasicMaterial, Object3D, type PerspectiveCamera, PlaneGeometry, Quaternion, ShaderMaterial, SphereGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cohort } from '../../state/cohortStore';
import { scenes } from '../../state/sceneStore';
import { ADDITIVE, HALO_FALLOFF, hazeMaterial } from '../materials/shared';
import { makeShell } from '../Nebula/geometry';
import { coreMaterial, haloMaterial, membraneMaterial } from '../Nebula/materials';
import { CONDITION_COLOR, INTERFACE } from '../palette';
import { filamentGeometry } from '../RunLattice/RunLattice';
import { LANE, REP, TILE_H, TILE_W, VISIBLE_H, VISIBLE_W, instanceIndex, latticeLayout, type LatticeLayout, type Vec3 } from '../RunLattice/layout';

/**
 * The study's design, drawn on the same sheet as the run lattice. The story never transforms the data:
 * the sheet is there from the start. One bug is a body of light, six paths leave it for its six condition
 * rows, each path forks into its two repeats, and pulling back shows that those twelve tiles are one
 * column among all 77. The conditions are parallel arms, so every path leaves the same bug. Nothing here
 * shows the order runs happened in, and tiles stay neutral: outcomes belong to the findings.
 *
 * Stage progress is a target, never a timeline, so a reversed or interrupted move carries on from where it is.
 */
const NEUTRAL = new Color(INTERFACE.text2);
const FOCUS = new Color(INTERFACE.ember);
const BODY_BACK = 34;       // columns between the bug's body and its condition rows
const FORK_BACK = 3;        // columns before the rows where each path forks
const BODY_SCALE = 0.62;
const HALO_GROW = [3.6, 1.7] as const;
const SURFACE = new Vector3(0, 0, 1);
const WIDE_TILE = 3.4;      // repeat tiles read as tiles up close, then narrow to fit their column
const TEXT_COLUMN = (w: number) => (w >= 1100 ? 450 : 370);
const SHELLS = [
  { seed: 3, radius: 1, phase: 0.4, freq: 1, bias: 0, opacity: 0.6 },
  { seed: 5, radius: 0.78, phase: 2.1, freq: 1.2, bias: 0.35, opacity: 0.65 },
  { seed: 9, radius: 1.22, phase: 4, freq: 0.9, bias: 0.65, opacity: 0.38 },
];
/** Which of the three framings each story stage uses. */
const FRAMING = [0, 1, 1, 2, 2];

function tube(curve: CubicBezierCurve3, radius: number, color: Color, lane: number, fork: number): BufferGeometry {
  const g = new TubeGeometry(curve, fork ? 28 : 72, radius, 8, false);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.toArray(c, i * 3);
  g.setAttribute('aColor', new BufferAttribute(c, 3));
  g.setAttribute('aLane', new BufferAttribute(new Float32Array(n).fill(lane), 1));
  g.setAttribute('aFork', new BufferAttribute(new Float32Array(n).fill(fork), 1));
  return g;
}

/** Six paths from the bug, each forking into two, in one draw call. */
function pathGeometry(L: LatticeLayout, col: number, colors: Color[]): BufferGeometry {
  const v = (c: number, across: number) => new Vector3(...L.at(c, across, [0, 0, 0] as Vec3));
  const start = v(col - BODY_BACK, 0);
  const parts: BufferGeometry[] = [];
  for (let r = 0; r < L.lanes; r++) {
    const row = L.laneAt(r);
    const fork = v(col - FORK_BACK, row);
    const out = new Vector3(start.x + (fork.x - start.x) * 0.42, start.y + row * 0.16, start.z);
    const inn = new Vector3(start.x + (fork.x - start.x) * 0.55, fork.y, fork.z);
    parts.push(tube(new CubicBezierCurve3(start, out, inn, fork), 0.03, colors[r], r, 0));
    for (const q of [-1, 1]) {
      const end = v(col, row + q * REP);
      const mid = fork.clone().lerp(end, 0.5);
      parts.push(tube(new CubicBezierCurve3(fork, new Vector3(mid.x, fork.y, mid.z), new Vector3(mid.x, end.y, mid.z), end), 0.02, colors[r], r, 1));
    }
  }
  const merged = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return merged;
}

const PATH_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aLane;
attribute float aFork;
uniform float uEmerge;
uniform float uForks;
uniform float uPaths;
uniform float uInflate;
varying vec3 vColor;
varying float vShow;
varying float vFacing;
void main() {
  // The six paths leave together but not in lockstep, and each forks only once it has arrived.
  float reveal = aFork < 0.5 ? clamp(uEmerge * 1.7 - aLane * 0.14, 0.0, 1.0) : uForks;
  vShow = smoothstep(reveal + 0.015, reveal - 0.015, uv.x) * step(0.001, reveal) * uPaths;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position + normal * uInflate, 1.0);
  vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;

const pathFragment = (body: string) => /* glsl */ `
varying vec3 vColor;
varying float vShow;
varying float vFacing;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
  #include <colorspace_fragment>
  float a = vShow * (${body});
  gl_FragColor = vec4(gl_FragColor.rgb * a, a);
}`;

const TILE_VERTEX = /* glsl */ `
attribute float aFocus;
attribute float aDelay;
uniform float uRepeats;
uniform float uCohort;
uniform float uFull;
uniform float uWide;
uniform vec2 uGrow;
varying vec2 vUv;
varying float vFocus;
varying float vA;
void main() {
  vUv = uv;
  vFocus = aFocus;
  float others = smoothstep(aDelay, aDelay + 0.35, uCohort);
  vA = aFocus > 0.5 ? uRepeats : others * (0.3 + 0.55 * uFull);
  vec2 local = position.xy * uGrow * vec2(aFocus > 0.5 ? uWide : 1.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(local, 0.0, 1.0);
}`;

const TILE_FRAGMENT = /* glsl */ `
uniform vec3 uNeutral;
uniform vec3 uFocusColor;
varying vec2 vUv;
varying float vFocus;
varying float vA;
void main() {
  vec2 q = abs(vUv - 0.5) * 2.0 / vec2(${VISIBLE_W.toFixed(4)}, ${VISIBLE_H.toFixed(4)});
  vec2 d = max(q - vec2(0.42, 0.56), 0.0) / vec2(0.34, 0.26);
  float edge = smoothstep(1.0, 0.8, length(d));
  gl_FragColor = vec4(mix(uNeutral, uFocusColor, vFocus), 1.0);
  #include <colorspace_fragment>
  float a = edge * vA;
  gl_FragColor = vec4(gl_FragColor.rgb * a, a);
}`;

const HALO_FRAGMENT = /* glsl */ `
${HALO_FALLOFF}
uniform vec3 uNeutral;
uniform vec3 uFocusColor;
varying vec2 vUv;
varying float vFocus;
varying float vA;
void main() {
  float f = haloFalloff(length((vUv - 0.5) * 2.0));
  gl_FragColor = vec4(mix(uNeutral, uFocusColor, vFocus), 1.0);
  #include <colorspace_fragment>
  float a = f * vA * mix(0.06, 0.4, vFocus);
  gl_FragColor = vec4(gl_FragColor.rgb * a, a);
}`;

interface Pose { target: Vector3; dist: number; yaw: number; el: number }

export default function CohortScene() {
  const mesh = useRef<InstancedMesh>(null);
  const halo = useRef<InstancedMesh>(null);
  const haze = useRef<Mesh>(null);
  const body = useRef<Group>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const { tasks, arms, focus } = cohort;

  const L = useMemo(() => latticeLayout(tasks, arms, true), [tasks, arms]);
  const col = L.colAt(focus);

  const geo = useMemo(() => {
    const g = new PlaneGeometry(1, 1);
    const flag = new Float32Array(L.count), delay = new Float32Array(L.count);
    for (let i = 0; i < L.bugs; i++) {
      const far = Math.abs(L.colAt(i) - col) / L.columns;
      for (let r = 0; r < L.lanes; r++) for (let q = 0; q < L.repeats; q++) {
        const n = instanceIndex(L, i, r, q);
        flag[n] = i === focus ? 1 : 0;
        delay[n] = far * 0.62;
      }
    }
    g.setAttribute('aFocus', new InstancedBufferAttribute(flag, 1));
    g.setAttribute('aDelay', new InstancedBufferAttribute(delay, 1));
    return g;
  }, [L, col, focus]);
  const colors = useMemo(() => arms.map((a) => new Color(CONDITION_COLOR[a.id])), [arms]);
  const rows = useMemo(() => filamentGeometry(L, colors), [L, colors]);
  const paths = useMemo(() => pathGeometry(L, col, colors), [L, col, colors]);
  const quad = useMemo(() => new PlaneGeometry(1, 1), []);

  const st = useMemo(() => ({
    emerge: { value: 0 },
    forks: { value: 0 },
    repeats: { value: 0 },
    paths: { value: 1 },
    cohort: { value: 0 },
    full: { value: 0 },
    wide: { value: WIDE_TILE },
    inflateCore: { value: 0 },
    inflateGlow: { value: 0.1 },
    bodyFade: 1,
    view: -1,
    fitted: '',
  }), []);

  // The bug's body: the Nebula's own shells and warm core, small, with the ember ring of a selection.
  const shape = useMemo(() => ({
    layers: SHELLS.map((s) => {
      const { fill, wire } = makeShell(120, 44, 2.3, s.seed);
      return {
        fill, wire,
        wireMat: membraneMaterial({ ...s, lines: true, depth: [24, 44] }),
        fillMat: membraneMaterial({ ...s, lines: false, depth: [24, 44] }),
      };
    }),
    core: new SphereGeometry(0.34, 40, 28), coreMat: coreMaterial(),
    glow: new PlaneGeometry(4.4, 4.4), glowMat: haloMaterial(),
    ring: new TorusGeometry(1.42, 0.012, 8, 120),
    ringMat: new MeshBasicMaterial({ color: FOCUS, transparent: true, depthWrite: false, toneMapped: false }),
  }), []);

  const materials = useMemo(() => {
    const tile = (grow: readonly [number, number], fragmentShader: string) => new ShaderMaterial({
      ...ADDITIVE, depthTest: false, side: DoubleSide,
      uniforms: {
        uRepeats: st.repeats, uCohort: st.cohort, uFull: st.full, uWide: st.wide,
        uGrow: { value: new Vector2(grow[0], grow[1]) },
        uNeutral: { value: NEUTRAL }, uFocusColor: { value: FOCUS },
      },
      vertexShader: TILE_VERTEX, fragmentShader,
    });
    const path = (inflate: { value: number }, light: string) => new ShaderMaterial({
      ...ADDITIVE, depthTest: false,
      uniforms: { uEmerge: st.emerge, uForks: st.forks, uPaths: st.paths, uInflate: inflate },
      vertexShader: PATH_VERTEX, fragmentShader: pathFragment(light),
    });
    return {
      tile: tile([1, 1], TILE_FRAGMENT),
      halo: tile(HALO_GROW, HALO_FRAGMENT),
      pathCore: path(st.inflateCore, '0.95'),
      pathGlow: path(st.inflateGlow, 'vFacing * vFacing * 0.26'),
      rows: new ShaderMaterial({
        ...ADDITIVE, depthTest: false, side: DoubleSide,
        uniforms: { uCohort: st.cohort, uFull: st.full },
        vertexShader: /* glsl */ `
          attribute vec3 aColor;
          attribute float aAlong;
          uniform float uCohort;
          uniform float uFull;
          varying vec3 vColor;
          varying float vA;
          void main() {
            vColor = aColor;
            vA = uCohort * (0.34 + 0.5 * uFull) * smoothstep(0.0, 0.05, aAlong) * smoothstep(1.0, 0.92, aAlong);
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
      }),
      haze: hazeMaterial({ seed: 3.7, intensity: 0.7, warmth: 0.5 }),
    };
  }, [st]);

  useEffect(() => () => {
    geo.dispose(); rows.dispose(); paths.dispose(); quad.dispose();
    shape.layers.forEach((l) => { l.fill.dispose(); l.wire.dispose(); l.wireMat.dispose(); l.fillMat.dispose(); });
    [shape.core, shape.glow, shape.ring].forEach((g) => g.dispose());
    [shape.coreMat, shape.glowMat, shape.ringMat].forEach((m) => m.dispose());
    Object.values(materials).forEach((m) => m.dispose());
  }, [geo, rows, paths, quad, shape, materials]);

  // Static matrices, written once; the halo draws from the tile's buffer.
  const place = useMemo(() => ({ dummy: new Object3D(), n: new Vector3(), q: new Quaternion() }), []);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const { dummy, n: normal, q } = place;
    for (let n = 0; n < L.count; n++) {
      normal.fromArray(L.dir, n * 3);
      dummy.position.fromArray(L.pos, n * 3);
      dummy.quaternion.copy(q.setFromUnitVectors(SURFACE, normal));
      dummy.scale.set(TILE_W, TILE_H, 1);
      dummy.updateMatrix();
      m.setMatrixAt(n, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    if (halo.current) halo.current.instanceMatrix = m.instanceMatrix;
  }, [L, place]);

  const bodyAt = useMemo(() => L.at(col - BODY_BACK, 0, [0, 0, 0]), [L, col]);

  // Three framings of one sheet, fitted to the part of the stage beside the text: the bug, its twelve
  // attempts, and everything.
  const poses = useMemo<Pose[]>(() => {
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const aspect = (size.width - TEXT_COLUMN(size.width)) / Math.max(1, size.height);
    const fit = (w: number, h: number) => Math.max(h / 2 / tan, w / 2 / (tan * aspect)) * 1.1;
    const end = L.at(col, 0, [0, 0, 0]);
    const left = L.at(0, 0, [0, 0, 0]), right = L.at(L.columns - 1, 0, [0, 0, 0]);
    return [
      { target: new Vector3(bodyAt[0], 0, bodyAt[2]), dist: fit(4.4, 4.2), yaw: 0, el: 0.04 },
      { target: new Vector3((bodyAt[0] + end[0]) / 2 + 0.5, 0, (bodyAt[2] + end[2]) / 2), dist: fit(Math.abs(end[0] - bodyAt[0]) + 4.4, (L.lanes + 0.5) * LANE), yaw: 0, el: 0.05 },
      { target: new Vector3(0, 0, -0.9), dist: fit(right[0] - left[0] + 0.9, (L.lanes + 0.7) * LANE), yaw: -0.12, el: 0.24 },
    ];
  }, [L, col, bodyAt, camera, size]);

  const scratch = useMemo(() => ({ t: new Vector3(), v: new Vector3(), p: [0, 0, 0] as Vec3 }), []);

  useFrame((_, dtRaw) => {
    if (!scenes.isVisible('cohort')) { scenes.settle('cohort'); return; }
    const { stage, reduced } = cohort;
    const dt = Math.min(dtRaw, 0.05);
    const rate = (lambda: number) => (reduced ? 1 : 1 - Math.exp(-dt * lambda));
    let busy = false;
    const ease = (cur: number, want: number, lambda: number): number => {
      if (Math.abs(want - cur) < 1e-3) return want;
      busy = true;
      return cur + (want - cur) * rate(lambda);
    };

    st.emerge.value = ease(st.emerge.value, stage >= 1 ? 1 : 0, 2.4);
    st.forks.value = ease(st.forks.value, stage >= 2 ? 1 : 0, 3.4);
    st.repeats.value = ease(st.repeats.value, stage >= 2 ? 1 : 0, 4);
    st.paths.value = ease(st.paths.value, stage >= 3 ? 0 : 1, 3);
    st.cohort.value = ease(st.cohort.value, stage >= 3 ? 1 : 0, 2.2);
    st.full.value = ease(st.full.value, stage >= 4 ? 1 : 0, 3);
    st.wide.value = ease(st.wide.value, stage >= 3 ? 1 : WIDE_TILE, 2.6);
    st.bodyFade = ease(st.bodyFade, stage >= 3 ? 0 : 1, 3);

    const b = body.current;
    if (b) {
      b.visible = st.bodyFade > 0.01;
      b.scale.setScalar(BODY_SCALE * (0.25 + 0.75 * st.bodyFade));
      for (const l of shape.layers) { l.wireMat.uniforms.uIntensity.value = st.bodyFade; l.fillMat.uniforms.uIntensity.value = st.bodyFade; }
      shape.glowMat.uniforms.uOpacity.value = st.bodyFade;
      shape.ringMat.opacity = st.bodyFade * 0.85;
    }

    const want = FRAMING[stage];
    const fitted = `${size.width}x${size.height}`;
    if (st.view < 0) st.view = want;
    const view = ease(st.view, want, 2.2);
    if (view !== st.view || st.fitted !== fitted) {
      st.view = view; st.fitted = fitted;
      const seg = Math.min(1, Math.floor(view));
      const f = view - seg;
      const e = f * f * (3 - 2 * f);
      const a = poses[seg], z = poses[seg + 1];
      const dist = a.dist + (z.dist - a.dist) * e;
      const yaw = a.yaw + (z.yaw - a.yaw) * e;
      const el = a.el + (z.el - a.el) * e;
      const { t, v, p } = scratch;
      t.lerpVectors(a.target, z.target, e);
      camera.position.set(t.x + Math.sin(yaw) * Math.cos(el) * dist, t.y + Math.sin(el) * dist, t.z + Math.cos(yaw) * Math.cos(el) * dist);
      camera.lookAt(t);
      // The model sits in the part of the stage the text leaves free.
      camera.setViewOffset(size.width, size.height, TEXT_COLUMN(size.width) / 2, 0, size.width, size.height);
      camera.updateMatrixWorld();

      // The atmosphere stays inside the stage at every framing, so its edge never meets the scissor.
      const hz = haze.current;
      if (hz) {
        const tall = 2 * Math.tan((camera.fov * Math.PI) / 360) * dist * 0.98;
        hz.position.copy(t);
        hz.quaternion.copy(camera.quaternion);
        hz.scale.set(tall * (size.width / Math.max(1, size.height)), tall, 1);
      }

      const label = (node: HTMLElement | null | undefined) => {
        if (!node) return;
        v.project(camera);
        node.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
      };
      for (let r = 0; r < L.lanes; r++) { v.fromArray(L.at(col + 1.2, L.laneAt(r), p)); label(cohort.labels[r]); }
      v.set(bodyAt[0], bodyAt[1] - 1.36, bodyAt[2]);
      label(cohort.labels[L.lanes]);
    }
    if (busy) scenes.animate('cohort'); else scenes.settle('cohort');
  });

  useEffect(() => () => { scenes.settle('cohort'); }, []);

  return (
    <>
      <mesh ref={haze} geometry={quad} material={materials.haze} renderOrder={0} raycast={() => null} />
      <mesh geometry={rows} material={materials.rows} renderOrder={1} raycast={() => null} />
      <mesh geometry={paths} material={materials.pathGlow} renderOrder={1} frustumCulled={false} raycast={() => null} />
      <mesh geometry={paths} material={materials.pathCore} renderOrder={2} frustumCulled={false} raycast={() => null} />
      <group ref={body} position={bodyAt} rotation={[0.2, 0.4, 0]}>
        <mesh geometry={shape.glow} material={shape.glowMat} renderOrder={2} raycast={() => null} />
        {shape.layers.map((l, i) => (
          <group key={i}>
            <mesh geometry={l.fill} material={l.fillMat} renderOrder={3} raycast={() => null} />
            <lineSegments geometry={l.wire} material={l.wireMat} renderOrder={4} raycast={() => null} />
          </group>
        ))}
        <mesh geometry={shape.core} material={shape.coreMat} renderOrder={5} raycast={() => null} />
        <mesh geometry={shape.ring} material={shape.ringMat} rotation={[1.25, 0, 0]} renderOrder={5} raycast={() => null} />
      </group>
      <instancedMesh ref={halo} args={[geo, materials.halo, L.count]} renderOrder={2} frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={mesh} args={[geo, materials.tile, L.count]} renderOrder={3} frustumCulled={false} raycast={() => null} />
    </>
  );
}
