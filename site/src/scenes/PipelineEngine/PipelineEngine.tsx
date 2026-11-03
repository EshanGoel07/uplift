import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, LineBasicMaterial,
  MathUtils, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Points, ShaderMaterial, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import { live, requestFrame, ui } from '../../state/sceneStore';
import { damp, rectToWorld, smooth } from '../layout';
import { SPECTRAL } from '../palette';
import { rng } from '../SignalField/geometry';

const N = 5;
const C = {
  cyan: new Color(SPECTRAL.cyan), blue: new Color(SPECTRAL.blue), violet: new Color(SPECTRAL.violet),
  magenta: new Color(SPECTRAL.magenta), amber: new Color(SPECTRAL.amber), core: new Color(SPECTRAL.core),
};

/** Soft round additive points with per-vertex colour and alpha. */
function pointsMaterial(size: number) {
  return new ShaderMaterial({
    uniforms: { uSize: { value: size }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uSize; attribute vec3 color; attribute float aA; varying vec3 vC; varying float vA;
      void main() { vC = color; vA = aA; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize * (18.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; varying vec3 vC; varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA * uOpacity; gl_FragColor = vec4(vC * a, a); }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending, premultipliedAlpha: true,
  });
}

function makePoints(n: number) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aA', new BufferAttribute(new Float32Array(n).fill(1), 1));
  return g;
}

const ringGeo = (r: number, segs = 96) => {
  const pts: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    pts.push(Math.cos(a0) * r, Math.sin(a0) * r, 0, Math.cos(a1) * r, Math.sin(a1) * r, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  return g;
};

/**
 * Pinned sequence C: five modules, one per real stage of the method, joined by flowing links.
 * 01 bug particles assemble into task units; 02 a timeline is cut into dev and test; 03 a file graph
 * lights up by risk; 04 a core emits the six setups; 05 two repeat streams pass a grading gate and
 * split into resolved and failed.
 */
export function PipelineEngine() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const group = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const modules = useRef<(Group | null)[]>([]);
  const act = useRef<number[]>(Array(N).fill(0));
  const userRot = useRef({ x: 0, y: 0 });
  const zoom = useRef(1);
  const stageRect = useRef<DOMRect | null>(null);
  const lowTier = ui.get().lowTier;

  const R = useMemo(() => {
    const rand = rng(91);
    const pm = (s: number) => pointsMaterial(s);
    // 01 Mine: 9 task cubes, particles that converge onto them.
    const mineN = lowTier ? 140 : 260;
    const mine = { geo: makePoints(mineN), mat: pm(3.2), from: new Float32Array(mineN * 3), to: new Float32Array(mineN * 3),
      cubes: new BoxGeometry(0.22, 0.22, 0.22), cubeMat: new MeshBasicMaterial({ color: C.amber, transparent: true, wireframe: true, blending: AdditiveBlending, depthWrite: false }) };
    for (let i = 0; i < mineN; i++) {
      const u = rand() * 2 - 1, th = rand() * Math.PI * 2, r = 0.7 + rand() * 0.5, s = Math.sqrt(1 - u * u);
      mine.from.set([s * Math.cos(th) * r, s * Math.sin(th) * r, u * r], i * 3);
      const k = i % 9; const cx = (k % 3 - 1) * 0.3, cy = (Math.floor(k / 3) - 1) * 0.3;
      mine.to.set([cx + (rand() - 0.5) * 0.18, cy + (rand() - 0.5) * 0.18, (rand() - 0.5) * 0.18], i * 3);
      const c = (k % 3 === 0 ? C.cyan : k % 3 === 1 ? C.blue : C.violet);
      (mine.geo.getAttribute('color') as BufferAttribute).setXYZ(i, c.r, c.g, c.b);
    }
    // 02 Split: a timeline of ticks, cut into dev (violet) and test (cyan).
    const ticksN = 40;
    const tl = { geo: makePoints(ticksN * 3), mat: pm(2.6), bar: new BoxGeometry(1.7, 0.02, 0.02),
      barMat: new MeshBasicMaterial({ color: C.blue, transparent: true, blending: AdditiveBlending, depthWrite: false }),
      blade: new BoxGeometry(0.015, 0.9, 0.015), bladeMat: new MeshBasicMaterial({ color: C.core, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }) };
    // 03 Risk graph: nodes with risk-sized points and edges.
    const nodesN = 16;
    const nodes: Vector3[] = [], risk: number[] = [];
    for (let i = 0; i < nodesN; i++) {
      const a = (i / nodesN) * Math.PI * 2 + rand() * 0.3, r = 0.35 + rand() * 0.45;
      nodes.push(new Vector3(Math.cos(a) * r, Math.sin(a) * r, (rand() - 0.5) * 0.5));
      risk.push(Math.pow(rand(), 2.2));
    }
    const edges: number[] = [];
    for (let i = 0; i < nodesN; i++) for (let j = i + 1; j < nodesN; j++) if (nodes[i].distanceTo(nodes[j]) < 0.5 && rand() < 0.7) edges.push(i, j);
    const graph = { nodes, risk, ptsGeo: makePoints(nodesN), ptsMat: pm(9), edgeGeo: new BufferGeometry(),
      edgeMat: new LineBasicMaterial({ color: C.violet, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false }) };
    graph.edgeGeo.setAttribute('position', new BufferAttribute(new Float32Array(edges.flatMap((k) => nodes[k].toArray())), 3));
    nodes.forEach((n, i) => {
      (graph.ptsGeo.getAttribute('position') as BufferAttribute).setXYZ(i, n.x, n.y, n.z);
      const c = C.blue.clone().lerp(C.magenta, risk[i]);
      (graph.ptsGeo.getAttribute('color') as BufferAttribute).setXYZ(i, c.r, c.g, c.b);
    });
    // 04 Generate: warm core with six orbiting setups.
    const gen = { core: new SphereGeometry(0.16, 32, 24), coreMat: new MeshBasicMaterial({ color: C.core.clone().multiplyScalar(1.6), toneMapped: false }),
      sats: new SphereGeometry(0.055, 16, 12), satGeo: makePoints(6), satMat: pm(12), orbit: ringGeo(0.5),
      orbitMat: new LineBasicMaterial({ color: C.violet, transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false }) };
    [C.core, C.cyan, C.blue, C.violet, C.magenta, C.amber].forEach((c, i) => (gen.satGeo.getAttribute('color') as BufferAttribute).setXYZ(i, c.r, c.g, c.b));
    // 05 Run and grade: two streams through a gate, then resolved (warm, up) or failed (magenta, down).
    const runN = lowTier ? 120 : 220;
    const run = { geo: makePoints(runN), mat: pm(3.4), gate: new TorusGeometry(0.34, 0.012, 8, 72),
      gateMat: new MeshBasicMaterial({ color: C.cyan, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
      seeds: Float32Array.from({ length: runN }, () => rand()) };
    // Module frames and links.
    const frame = ringGeo(0.78, 128);
    const frameMat = () => new LineBasicMaterial({ color: C.blue, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false });
    const frames = Array.from({ length: N }, frameMat);
    const linkSegs = 40;
    const linkGeo = new BufferGeometry();
    linkGeo.setAttribute('position', new BufferAttribute(new Float32Array((N - 1) * linkSegs * 2 * 3), 3));
    linkGeo.setAttribute('aT', new BufferAttribute(new Float32Array((N - 1) * linkSegs * 2), 1));
    linkGeo.setAttribute('aLink', new BufferAttribute(new Float32Array((N - 1) * linkSegs * 2), 1));
    const linkMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uActive: { value: Array(N - 1).fill(0) }, uOpacity: { value: 1 }, uA: { value: C.cyan }, uB: { value: C.magenta }, uHot: { value: C.amber } },
      vertexShader: /* glsl */ `attribute float aT; attribute float aLink; varying float vT; varying float vL; void main(){ vT = aT; vL = aLink; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uActive[4]; uniform float uOpacity; uniform vec3 uA; uniform vec3 uB; uniform vec3 uHot;
        varying float vT; varying float vL;
        void main(){
          int i = int(vL + 0.5);
          float act = uActive[0];
          if (i == 1) act = uActive[1]; else if (i == 2) act = uActive[2]; else if (i == 3) act = uActive[3];
          float dash = step(0.55, fract(vT * 14.0 - uTime * 1.4));
          vec3 c = mix(mix(uA, uB, vT), uHot, act * 0.6);
          float a = (0.12 + act * (0.35 + 0.55 * dash)) * uOpacity;
          gl_FragColor = vec4(c * a * (1.0 + act), a);
        }`,
      transparent: true, depthWrite: false, blending: AdditiveBlending, premultipliedAlpha: true,
    });
    const hit = new SphereGeometry(0.85, 12, 8);
    const hitMat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    return { mine, tl, graph, gen, run, frame, frames, linkGeo, linkMat, linkSegs, hit, hitMat };
  }, [lowTier]);

  useEffect(() => () => {
    const disposables: { dispose: () => void }[] = [
      R.mine.geo, R.mine.mat, R.mine.cubes, R.mine.cubeMat, R.tl.geo, R.tl.mat, R.tl.bar, R.tl.barMat, R.tl.blade, R.tl.bladeMat,
      R.graph.ptsGeo, R.graph.ptsMat, R.graph.edgeGeo, R.graph.edgeMat, R.gen.core, R.gen.coreMat, R.gen.sats, R.gen.satGeo, R.gen.satMat,
      R.gen.orbit, R.gen.orbitMat, R.run.geo, R.run.mat, R.run.gate, R.run.gateMat, R.frame, R.linkGeo, R.linkMat, R.hit, R.hitMat, ...R.frames,
    ];
    disposables.forEach((d) => d.dispose());
  }, [R]);

  useEffect(() => {
    const read = () => { stageRect.current = document.querySelector('.method__stage')?.getBoundingClientRect() ?? null; };
    read();
    window.addEventListener('resize', read);
    window.addEventListener('scroll', read, { passive: true });
    return () => { window.removeEventListener('resize', read); window.removeEventListener('scroll', read); };
  }, []);

  const cubes = useRef<InstancedMesh>(null);
  const blade = useRef<Mesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const positions = useMemo(() => Array.from({ length: N }, () => new Vector3()), []);
  const sats = useRef<Points>(null);

  const onPick = (i: number) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6 || (group.current && !group.current.visible)) return;
    e.stopPropagation();
    ui.set({ pipelinePick: i });
    requestFrame();
  };

  useFrame((_, rawDt) => {
    const g = group.current, inn = inner.current;
    if (!g || !inn) return;
    const dt = Math.min(rawDt, 0.05);
    const vis = live.pipelineVis * (1 - live.pipelineOut);
    g.visible = vis > 0.01;
    if (!g.visible) return;
    const t = live.time;
    const r = stageRect.current;
    if (!r) return;
    const w = rectToWorld(r, camera);
    const vertical = r.height > r.width * 1.05;
    const span = vertical ? w.h * 0.86 : w.w * 0.9;
    const step = span / (N - 1);
    const s = Math.min(step * 0.6, (vertical ? w.w : w.h) * 0.46);
    g.position.set(w.x, w.y, 0);
    zoom.current = damp(zoom.current, live.zoom.pipeline, 6, dt);
    g.scale.setScalar(zoom.current);
    userRot.current.x = damp(userRot.current.x, live.rot.pipeline.x, 5, dt);
    userRot.current.y = damp(userRot.current.y, live.rot.pipeline.y, 5, dt);
    inn.rotation.set((vertical ? 0.1 : -0.22) + userRot.current.x, (vertical ? -0.3 : -0.32) + userRot.current.y, 0);

    // Activation: scroll builds the pipeline stage by stage; a click highlights one module.
    const st = ui.get();
    const prog = live.pipeline * N * 1.12;
    for (let i = 0; i < N; i++) {
      let target = MathUtils.clamp(prog - i, 0, 1);
      const focus = st.pipelinePick ?? st.pipelineStage;
      if (st.pipelinePick !== null) target = i === focus ? 1 : Math.min(target, 0.45);
      act.current[i] = damp(act.current[i], target, 6, dt);
    }
    const focus = st.pipelinePick ?? st.pipelineStage;

    for (let i = 0; i < N; i++) {
      const m = modules.current[i];
      const k = i - (N - 1) / 2;
      positions[i].set(vertical ? 0 : k * step, vertical ? -k * step : 0, vertical ? 0 : Math.abs(k) * -0.15);
      if (m) {
        m.position.copy(positions[i]);
        const a = act.current[i];
        m.scale.setScalar(s * (0.55 + 0.45 * a) * (i === focus ? 1.08 : 1));
      }
      const fm = R.frames[i];
      fm.opacity = (0.12 + 0.5 * act.current[i] + (i === focus ? 0.3 : 0)) * vis;
      fm.color.copy(i === focus ? C.amber : C.blue);
    }

    // Links between modules (cubic-ish arcs), lit as the next stage activates.
    const lp = R.linkGeo.getAttribute('position') as BufferAttribute;
    const lt = R.linkGeo.getAttribute('aT') as BufferAttribute;
    const ll = R.linkGeo.getAttribute('aLink') as BufferAttribute;
    for (let l = 0; l < N - 1; l++) {
      const p0 = positions[l], p1 = positions[l + 1];
      for (let k = 0; k < R.linkSegs; k++) {
        for (let e = 0; e < 2; e++) {
          const tt = (k + e) / R.linkSegs;
          const idx = (l * R.linkSegs + k) * 2 + e;
          const bow = Math.sin(tt * Math.PI) * s * 0.35;
          lp.setXYZ(idx, MathUtils.lerp(p0.x, p1.x, tt) + (vertical ? bow : 0), MathUtils.lerp(p0.y, p1.y, tt) + (vertical ? 0 : bow), MathUtils.lerp(p0.z, p1.z, tt));
          lt.setX(idx, tt); ll.setX(idx, l);
        }
      }
      (R.linkMat.uniforms.uActive.value as number[])[l] = Math.min(act.current[l], act.current[l + 1]);
    }
    lp.needsUpdate = true; lt.needsUpdate = true; ll.needsUpdate = true;
    R.linkMat.uniforms.uTime.value = t;
    R.linkMat.uniforms.uOpacity.value = vis;

    // 01 Mine
    {
      const a = smooth(0.15, 0.95, act.current[0]);
      const pos = R.mine.geo.getAttribute('position') as BufferAttribute;
      const n = pos.count;
      for (let i = 0; i < n; i++) {
        const wob = (1 - a) * 0.06;
        pos.setXYZ(i,
          MathUtils.lerp(R.mine.from[i * 3], R.mine.to[i * 3], a) + Math.sin(t * 1.3 + i) * wob,
          MathUtils.lerp(R.mine.from[i * 3 + 1], R.mine.to[i * 3 + 1], a) + Math.cos(t * 1.1 + i * 1.7) * wob,
          MathUtils.lerp(R.mine.from[i * 3 + 2], R.mine.to[i * 3 + 2], a));
      }
      pos.needsUpdate = true;
      R.mine.mat.uniforms.uOpacity.value = vis * (0.4 + 0.6 * act.current[0]);
      R.mine.cubeMat.opacity = vis * smooth(0.6, 1, act.current[0]) * 0.8;
      if (cubes.current) {
        for (let k = 0; k < 9; k++) {
          dummy.position.set((k % 3 - 1) * 0.3, (Math.floor(k / 3) - 1) * 0.3, 0);
          dummy.rotation.set(t * 0.3 + k, t * 0.2, 0);
          dummy.scale.setScalar(smooth(0.5, 1, act.current[0]));
          dummy.updateMatrix();
          cubes.current.setMatrixAt(k, dummy.matrix);
        }
        cubes.current.instanceMatrix.needsUpdate = true;
      }
    }
    // 02 Split
    {
      const a = act.current[1];
      const cut = smooth(0.2, 0.8, a);
      const pos = R.tl.geo.getAttribute('position') as BufferAttribute;
      const colr = R.tl.geo.getAttribute('color') as BufferAttribute;
      const n = pos.count;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1) - 0.5) * 1.6;
        const isTest = x > 0.32;
        const shift = (isTest ? 0.16 : -0.06) * cut;
        const lane = (i % 3 - 1) * 0.07;
        pos.setXYZ(i, x + shift, lane + Math.sin(t * 2 + i) * 0.01, 0);
        const c = isTest ? C.cyan : C.violet;
        colr.setXYZ(i, c.r, c.g, c.b);
      }
      pos.needsUpdate = true; colr.needsUpdate = true;
      R.tl.mat.uniforms.uOpacity.value = vis * (0.4 + 0.6 * a);
      R.tl.barMat.opacity = vis * 0.4;
      R.tl.bladeMat.opacity = vis * cut;
      if (blade.current) blade.current.position.set(0.32 + 0.05 * cut, MathUtils.lerp(0.9, 0, cut), 0);
    }
    // 03 Risk graph
    {
      const a = act.current[2];
      const al = R.graph.ptsGeo.getAttribute('aA') as BufferAttribute;
      R.graph.risk.forEach((rk, i) => al.setX(i, 0.25 + 0.75 * smooth(0, 1, a * 1.4 - (1 - rk) * 0.6) * (0.7 + 0.3 * Math.sin(t * 2.4 + i))));
      al.needsUpdate = true;
      R.graph.ptsMat.uniforms.uOpacity.value = vis;
      R.graph.edgeMat.opacity = vis * (0.12 + 0.5 * a);
    }
    // 04 Generate
    {
      const a = act.current[3];
      const pos = R.gen.satGeo.getAttribute('position') as BufferAttribute;
      const rr = 0.18 + 0.32 * smooth(0, 1, a);
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + t * 0.6;
        pos.setXYZ(i, Math.cos(ang) * rr, Math.sin(ang) * rr * 0.55, Math.sin(ang) * rr * 0.6);
      }
      pos.needsUpdate = true;
      R.gen.satMat.uniforms.uOpacity.value = vis * (0.3 + 0.7 * a);
      R.gen.orbitMat.opacity = vis * 0.35 * a;
      (R.gen.coreMat.color as Color).copy(C.core).multiplyScalar((0.5 + 1.2 * a) * vis);
      if (sats.current) sats.current.rotation.x = 0.4;
    }
    // 05 Run and grade
    {
      const a = act.current[4];
      const pos = R.run.geo.getAttribute('position') as BufferAttribute;
      const colr = R.run.geo.getAttribute('color') as BufferAttribute;
      const n = pos.count;
      for (let i = 0; i < n; i++) {
        const sd = R.run.seeds[i];
        const lane = i % 2 === 0 ? 0.09 : -0.09;   // repeat 1 and repeat 2
        const ph = (t * (0.18 + sd * 0.05) + sd) % 1;
        const x = -0.85 + ph * 1.7;
        const ok = sd < 0.727;                     // the overall solve rate, for flavour only
        const after = smooth(0, 0.6, x);
        const y = lane * (1 - after) + (ok ? 0.42 : -0.42) * after * after;
        pos.setXYZ(i, x, y + Math.sin(i + t) * 0.01, 0);
        const c = after > 0.05 ? (ok ? C.core : C.magenta) : (i % 2 === 0 ? C.cyan : C.blue);
        colr.setXYZ(i, c.r, c.g, c.b);
      }
      pos.needsUpdate = true; colr.needsUpdate = true;
      R.run.mat.uniforms.uOpacity.value = vis * (0.2 + 0.8 * a);
      R.run.gateMat.opacity = vis * (0.3 + 0.7 * a);
    }
  });

  return (
    <group ref={group}>
      <group ref={inner}>
        <lineSegments geometry={R.linkGeo} material={R.linkMat} frustumCulled={false} />
        {Array.from({ length: N }, (_, i) => (
          <group key={i} ref={(el) => { modules.current[i] = el; }}>
            <lineSegments geometry={R.frame} material={R.frames[i]} />
            <mesh geometry={R.hit} material={R.hitMat} onClick={onPick(i)}
                  onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }} />
            {i === 0 && (
              <>
                <points geometry={R.mine.geo} material={R.mine.mat} frustumCulled={false} />
                <instancedMesh ref={cubes} args={[R.mine.cubes, R.mine.cubeMat, 9]} frustumCulled={false} />
              </>
            )}
            {i === 1 && (
              <>
                <mesh geometry={R.tl.bar} material={R.tl.barMat} />
                <points geometry={R.tl.geo} material={R.tl.mat} frustumCulled={false} />
                <mesh ref={blade} geometry={R.tl.blade} material={R.tl.bladeMat} />
              </>
            )}
            {i === 2 && (
              <>
                <lineSegments geometry={R.graph.edgeGeo} material={R.graph.edgeMat} />
                <points geometry={R.graph.ptsGeo} material={R.graph.ptsMat} frustumCulled={false} />
              </>
            )}
            {i === 3 && (
              <>
                <mesh geometry={R.gen.core} material={R.gen.coreMat} />
                <group rotation={[0.4, 0, 0]}><lineSegments geometry={R.gen.orbit} material={R.gen.orbitMat} /></group>
                <points ref={sats} geometry={R.gen.satGeo} material={R.gen.satMat} frustumCulled={false} />
              </>
            )}
            {i === 4 && (
              <>
                <mesh geometry={R.run.gate} material={R.run.gateMat} rotation={[0, Math.PI / 2, 0]} />
                <points geometry={R.run.geo} material={R.run.mat} frustumCulled={false} />
              </>
            )}
          </group>
        ))}
      </group>
    </group>
  );
}
