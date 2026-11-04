import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedBufferAttribute, InstancedMesh, Mesh, Object3D, PerspectiveCamera, PlaneGeometry, Quaternion, ShaderMaterial, Vector2, Vector3 } from 'three';
import { cohort } from '../../state/cohortStore';
import { scenes } from '../../state/sceneStore';
import { ADDITIVE, HALO_FALLOFF, hazeMaterial } from '../materials/shared';
import { CONDITION_COLOR, INTERFACE, SPECTRAL } from '../palette';
import { filamentGeometry } from '../RunLattice/RunLattice';
import { BUG, LANE, TILE_H, TILE_W, VISIBLE_H, VISIBLE_W, instanceIndex, latticeLayout, type LatticeLayout, type Vec3 } from '../RunLattice/layout';

/**
 * The study's design, drawn on the same sheet as the run lattice. The story never transforms anything:
 * the sheet is there from the start, the camera begins close on one bug, and pulling back shows that the
 * same structure holds for all 77. Six fine paths leave one bug for its six condition rows, because the
 * conditions are parallel arms of the study. Nothing here shows the order runs happened in, and all tiles
 * stay neutral: outcomes belong to the findings.
 */
const NEUTRAL = new Color(INTERFACE.text2);
const FOCUS = new Color(INTERFACE.ember);
const NODE_BACK = 13;      // columns between the bug's node and its condition rows
const HALO_GROW = [3.6, 1.7] as const;
const SURFACE = new Vector3(0, 0, 1);

/** One curve per condition, from the bug's node to its row. All in one draw call. */
function branchGeometry(L: LatticeLayout, col: number, colors: Color[]): BufferGeometry {
  const SEG = 48, THICK = 0.022;
  const n = (SEG + 1) * 2 * L.lanes;
  const position = new Float32Array(n * 3), color = new Float32Array(n * 3), along = new Float32Array(n), lane = new Float32Array(n);
  const index: number[] = [];
  const p: Vec3 = [0, 0, 0];
  let v = 0;
  for (let r = 0; r < L.lanes; r++) {
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const ease = t * t * (3 - 2 * t);
      const across = L.laneAt(r) * ease;
      for (const side of [-1, 1]) {
        position.set(L.at(col - NODE_BACK * (1 - t), across + side * THICK, p), v * 3);
        colors[r].toArray(color, v * 3);
        along[v] = t;
        lane[v] = r;
        v++;
      }
      if (s < SEG) index.push(v - 2, v - 1, v, v - 1, v + 1, v);
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

const tileVertex = /* glsl */ `
attribute float aFocus;
attribute float aDelay;
uniform float uRepeats;
uniform float uCohort;
uniform vec2 uGrow;
varying vec2 vUv;
varying float vFocus;
varying float vA;
void main() {
  vUv = uv;
  vFocus = aFocus;
  float others = smoothstep(aDelay, aDelay + 0.35, uCohort);
  vA = aFocus > 0.5 ? uRepeats : others * 0.42;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position.xy * uGrow, 0.0, 1.0);
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
uniform vec3 uFocusColor;
varying vec2 vUv;
varying float vFocus;
varying float vA;
void main() {
  float f = haloFalloff(length((vUv - 0.5) * 2.0));
  gl_FragColor = vec4(uFocusColor, 1.0);
  #include <colorspace_fragment>
  float a = f * vFocus * vA * 0.34;
  gl_FragColor = vec4(gl_FragColor.rgb * a, a);
}`;

export default function CohortScene() {
  const mesh = useRef<InstancedMesh>(null);
  const halo = useRef<InstancedMesh>(null);
  const haze = useRef<Mesh>(null);
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
  const branches = useMemo(() => branchGeometry(L, col, colors), [L, col, colors]);
  const quad = useMemo(() => new PlaneGeometry(1, 1), []);
  useEffect(() => () => { geo.dispose(); rows.dispose(); branches.dispose(); quad.dispose(); }, [geo, rows, branches, quad]);

  const st = useMemo(() => ({
    reveal: new Float32Array(L.lanes),
    repeats: { value: 0 },
    cohort: { value: 0 },
    branch: { value: 1 },
    view: -1,
    fitted: '',
  }), [L.lanes]);

  const materials = useMemo(() => {
    const tile = (grow: readonly [number, number], fragmentShader: string) => new ShaderMaterial({
      ...ADDITIVE, depthTest: false, side: DoubleSide,
      uniforms: {
        uRepeats: st.repeats, uCohort: st.cohort,
        uGrow: { value: new Vector2(grow[0], grow[1]) },
        uNeutral: { value: NEUTRAL }, uFocusColor: { value: FOCUS },
      },
      vertexShader: tileVertex, fragmentShader,
    });
    const line = (vertexBody: string) => new ShaderMaterial({
      ...ADDITIVE, depthTest: false, side: DoubleSide,
      uniforms: { uReveal: { value: st.reveal }, uCohort: st.cohort, uBranch: st.branch },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aAlong;
        attribute float aLane;
        uniform float uReveal[${st.reveal.length}];
        uniform float uCohort;
        uniform float uBranch;
        varying vec3 vColor;
        varying float vA;
        void main() {
          vColor = aColor;
          float reveal = uReveal[int(aLane + 0.5)];
          ${vertexBody}
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
    const node = new ShaderMaterial({
      ...ADDITIVE, depthTest: false,
      uniforms: { uBranch: st.branch, uCore: { value: new Color(SPECTRAL.core) }, uEmber: { value: FOCUS } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        ${HALO_FALLOFF}
        uniform float uBranch;
        uniform vec3 uCore;
        uniform vec3 uEmber;
        varying vec2 vUv;
        void main() {
          float d = length((vUv - 0.5) * 2.0);
          gl_FragColor = vec4(mix(uEmber, uCore, smoothstep(0.34, 0.05, d)), 1.0);
          #include <colorspace_fragment>
          float a = uBranch * (haloFalloff(d) * 0.55 + smoothstep(0.2, 0.12, d));
          gl_FragColor = vec4(gl_FragColor.rgb * a, a);
        }`,
    });
    return {
      tile: tile([1, 1], TILE_FRAGMENT),
      halo: tile(HALO_GROW, HALO_FRAGMENT),
      branch: line(`
        float front = smoothstep(reveal + 0.02, reveal - 0.02, aAlong) * step(0.001, reveal);
        vA = front * 0.85 * uBranch;
      `),
      rows: line(`
        vA = uCohort * 0.46 * smoothstep(0.0, 0.05, aAlong) * smoothstep(1.0, 0.92, aAlong);
      `),
      node,
      haze: hazeMaterial({ seed: 3.7, intensity: 0.62, warmth: 0.4 }),
    };
  }, [st]);
  useEffect(() => () => { Object.values(materials).forEach((m) => m.dispose()); }, [materials]);

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

  const nodeAt = useMemo(() => L.at(col - NODE_BACK, 0, [0, 0, 0]), [L, col]);

  // Two framings of the same sheet, fitted to the stage: close on one bug, and all of it.
  const poses = useMemo(() => {
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const aspect = size.width / Math.max(1, size.height);
    const fit = (w: number, h: number) => Math.max(h / 2 / tan, w / 2 / (tan * aspect)) * 1.12;
    const end = L.at(col, 0, [0, 0, 0]);
    const close = { target: new Vector3((nodeAt[0] + end[0]) / 2, 0, (nodeAt[2] + end[2]) / 2), dist: fit(NODE_BACK * BUG + 1.6, (L.lanes + 0.4) * LANE), yaw: 0, el: 0.05 };
    const left = L.at(0, 0, [0, 0, 0]), right = L.at(L.columns - 1, 0, [0, 0, 0]);
    const all = { target: new Vector3(0, 0, -0.9), dist: fit(right[0] - left[0] + 1, (L.lanes + 0.8) * LANE), yaw: -0.12, el: 0.24 };
    return { close, all };
  }, [L, col, nodeAt, camera, size]);

  const scratch = useMemo(() => ({ t: new Vector3() }), []);

  useFrame((_, dtRaw) => {
    if (!scenes.isVisible('cohort')) { scenes.settle('cohort'); return; }
    const { step, reduced } = cohort;
    const dt = Math.min(dtRaw, 0.05);
    const rate = (lambda: number) => (reduced ? 1 : 1 - Math.exp(-dt * lambda));
    let busy = false;
    const ease = (cur: number, want: number, lambda: number): number => {
      if (Math.abs(want - cur) < 1e-3) return want;
      busy = true;
      return cur + (want - cur) * rate(lambda);
    };

    // A later step simply changes the targets, so an interrupted or reversed move carries on from here.
    for (let r = 0; r < st.reveal.length; r++) st.reveal[r] = ease(st.reveal[r], r < step.lanes ? 1 : 0, 3.6);
    st.repeats.value = ease(st.repeats.value, step.repeats ? 1 : 0, 5);
    st.cohort.value = ease(st.cohort.value, step.cohort ? 1 : 0, 2.2);
    st.branch.value = ease(st.branch.value, step.cohort ? 0 : 1, 3.2);
    const want = step.cohort ? 1 : 0;
    const fitted = `${size.width}x${size.height}`;
    if (st.view < 0) st.view = want;
    const view = ease(st.view, want, 2.2);
    if (view !== st.view || st.fitted !== fitted) {
      st.view = view; st.fitted = fitted;
      const { close, all } = poses;
      const e = view * view * (3 - 2 * view);
      const dist = close.dist + (all.dist - close.dist) * e;
      const yaw = close.yaw + (all.yaw - close.yaw) * e;
      const el = close.el + (all.el - close.el) * e;
      scratch.t.lerpVectors(close.target, all.target, e);
      camera.position.set(scratch.t.x + Math.sin(yaw) * Math.cos(el) * dist, scratch.t.y + Math.sin(el) * dist, scratch.t.z + Math.cos(yaw) * Math.cos(el) * dist);
      camera.lookAt(scratch.t);
      camera.updateProjectionMatrix();
      // The atmosphere stays inside the stage at every framing, so its edge never meets the scissor.
      const hz = haze.current;
      if (hz) {
        const tall = 2 * Math.tan((camera.fov * Math.PI) / 360) * dist * 0.96;
        hz.position.set(scratch.t.x, scratch.t.y, scratch.t.z);
        hz.quaternion.copy(camera.quaternion);
        hz.scale.set(tall * (size.width / Math.max(1, size.height)), tall, 1);
      }
    }
    if (busy) scenes.animate('cohort'); else scenes.settle('cohort');
  });

  useEffect(() => () => { scenes.settle('cohort'); }, []);

  return (
    <>
      <mesh ref={haze} geometry={quad} material={materials.haze} renderOrder={0} raycast={() => null} />
      <mesh geometry={rows} material={materials.rows} renderOrder={1} raycast={() => null} />
      <mesh geometry={branches} material={materials.branch} renderOrder={1} raycast={() => null} />
      <mesh geometry={quad} material={materials.node} position={nodeAt} scale={[0.9, 0.9, 1]} renderOrder={2} raycast={() => null} />
      <instancedMesh ref={halo} args={[geo, materials.halo, L.count]} renderOrder={2} frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={mesh} args={[geo, materials.tile, L.count]} renderOrder={3} frustumCulled={false} raycast={() => null} />
    </>
  );
}
