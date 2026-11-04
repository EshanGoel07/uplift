import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, Group, Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, Points, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import type { ArmId } from '../../data/types';
import { groupOf } from '../../data/classify';
import { atlas, openTask } from '../../state/atlasStore';
import { lattice, latticeHandlers } from '../../state/latticeStore';
import { nebula, nebulaDom } from '../../state/nebulaStore';
import { requestFrame, scenes, ui } from '../../state/sceneStore';
import { OFF } from '../layout';
import { INTERFACE, OUTCOME } from '../palette';
import { makeDust, makeShell, makeStrands } from './geometry';
import { nebulaPositions, viewToFront } from './layout';
import { coreMaterial, dustMaterial, haloMaterial, membraneMaterial, strandMaterial } from './materials';

/**
 * The Nebula Atlas: the original Signal Field (shells, warm core, strands, dust) carrying one node per
 * real bug. It is an index of the dataset: select a node and the same bug is selected everywhere.
 *
 * Motion is bounded. The field drifts for a few seconds after it appears or is touched, then settles
 * and stops rendering. All selection and lens state is uniforms, so interaction uploads no buffers.
 * Picking projects the 77 nodes in JavaScript, which is cheap and needs no raycaster.
 */
const LAYERS = [
  { radius: 1.95, phase: 0.0, freq: 1.0, bias: -0.18, opacity: 0.5, rot: [0.18, 0.12, 0.0], seed: 3 },
  { radius: 1.64, phase: 3.1, freq: 1.18, bias: 0.3, opacity: 0.38, rot: [-0.2, 0.75, 0.5], seed: 17 },
  { radius: 1.34, phase: 6.3, freq: 1.32, bias: 0.62, opacity: 0.34, rot: [0.42, -0.55, -0.35], seed: 29 },
] as const;

const AMBIENT_S = 9, FADE_S = 2.5, COMPOSED_TIME = 14;
const HIT_PX = 15;

const OUTCOME_COLOR = { always: new Color(OUTCOME.solved), mixed: new Color(OUTCOME.mixed), never: new Color(OUTCOME.failed) };

const NODE_VERT = (n: number) => /* glsl */ `
attribute float aBug;
attribute vec3 aGroup;
uniform float uCond[${n}];
uniform float uSel, uHover, uLens, uKind, uDim, uPx;
uniform vec3 uBase, uEmber, uOk, uWarn, uFail;
varying vec3 vC;
varying float vA;
varying float vRing;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 lens = aGroup;
  if (uKind > 0.5) {
    float v = uCond[int(aBug + 0.5)];
    lens = v > 1.5 ? uOk : (v > 0.5 ? uWarn : uFail);
  }
  bool sel = abs(aBug - uSel) < 0.5;
  bool hov = abs(aBug - uHover) < 0.5;
  float front = clamp((mv.z + 10.0) / 4.5, 0.0, 1.0);
  vC = sel ? uEmber : mix(uBase, lens, uLens);
  vA = (sel || hov) ? 1.0 : mix(0.36, 1.0, front) * (1.0 - uDim * 0.74);
  vRing = sel ? 1.0 : 0.0;
  gl_PointSize = uPx * (sel ? 2.5 : (hov ? 1.9 : 1.0)) * (0.72 + 0.42 * front);
  gl_Position = projectionMatrix * mv;
}`;

const NODE_FRAG = /* glsl */ `
varying vec3 vC;
varying float vA;
varying float vRing;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float disc = 1.0 - smoothstep(0.58, 0.72, d);
  float ring = (1.0 - smoothstep(0.86, 0.98, d)) * smoothstep(0.72, 0.82, d);
  float a = disc + ring * vRing;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vC, a * vA);
}`;

export function NebulaScene() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const lowTier = ui.get().lowTier;
  const tasks = lattice.get().tasks;
  const n = tasks.length;
  const spin = useRef<Group>(null);
  const shells = useRef<Group>(null);
  const halo = useRef<Mesh>(null);
  const points = useRef<Points>(null);

  const pos = useMemo(() => nebulaPositions(n), [n]);
  const nodes = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aBug', new BufferAttribute(Float32Array.from({ length: n }, (_, i) => i), 1));
    const col = new Float32Array(n * 3);
    tasks.forEach((t, i) => OUTCOME_COLOR[groupOf(t.solved)].toArray(col, i * 3));
    g.setAttribute('aGroup', new BufferAttribute(col, 3));
    return g;
  }, [pos, n, tasks]);
  const nodeMat = useMemo(() => new ShaderMaterial({
    vertexShader: NODE_VERT(n), fragmentShader: NODE_FRAG, transparent: true, depthTest: false, depthWrite: false,
    uniforms: {
      uCond: { value: new Float32Array(n) }, uSel: { value: -1 }, uHover: { value: -1 }, uLens: { value: 0 }, uKind: { value: 0 }, uDim: { value: 0 }, uPx: { value: 9 },
      uBase: { value: new Color(INTERFACE.text) }, uEmber: { value: new Color(INTERFACE.ember) },
      uOk: { value: new Color(OUTCOME.solved) }, uWarn: { value: new Color(OUTCOME.mixed) }, uFail: { value: new Color(OUTCOME.failed) },
    },
  }), [n]);

  const parts = useMemo(() => {
    const segT = lowTier ? 96 : 190, segP = lowTier ? 34 : 66;
    const layers = LAYERS.map((l) => {
      const { fill, wire } = makeShell(segT, segP, 2.3, l.seed);
      return {
        ...l, fill, wire,
        wireMat: membraneMaterial({ radius: l.radius, phase: l.phase, freq: l.freq, bias: l.bias, opacity: l.opacity, lines: true }),
        fillMat: membraneMaterial({ radius: l.radius, phase: l.phase, freq: l.freq, bias: l.bias, opacity: l.opacity, lines: false }),
      };
    });
    return {
      layers,
      core: new SphereGeometry(0.4, 48, 32), coreMat: coreMaterial(),
      halo: new PlaneGeometry(5.2, 5.2), haloMat: haloMaterial(),
      strands: makeStrands(lowTier ? 60 : 120, 22, 7), strandMat: strandMaterial(),
      dust: makeDust(lowTier ? 500 : 1100, 0, 11), dustMat: dustMaterial(Math.min(gl.getPixelRatio(), 2)),
    };
  }, [lowTier, gl]);

  useEffect(() => () => {
    parts.layers.forEach((l) => { l.fill.dispose(); l.wire.dispose(); l.wireMat.dispose(); l.fillMat.dispose(); });
    [parts.core, parts.halo, parts.strands, parts.dust].forEach((g) => g.dispose());
    [parts.coreMat, parts.haloMat, parts.strandMat, parts.dustMat].forEach((m) => m.dispose());
    nodes.dispose(); nodeMat.dispose();
  }, [parts, nodes, nodeMat]);

  const st = useRef({
    time: COMPOSED_TIME, ambientUntil: 0, yaw: nebula.get().yaw, pitch: nebula.get().pitch, zoom: 1, lens: 0, dim: 0, focusTick: 0,
    dragging: false, moved: 0, lastX: 0, lastY: 0, down: false,
  });
  const scratch = useMemo(() => ({ v: new Vector3(), m: new Matrix4() }), []);

  const nearest = (clientX: number, clientY: number): number | null => {
    const stage = scenes.get('nebula').stage, p = points.current;
    if (!stage || !p) return null;
    const r = stage.getBoundingClientRect();
    let best = -1, bestD = HIT_PX * HIT_PX;
    for (let i = 0; i < n; i++) {
      scratch.v.fromArray(pos, i * 3).applyMatrix4(p.matrixWorld).project(camera);
      const dx = (scratch.v.x * 0.5 + 0.5) * r.width + r.left - clientX, dy = (0.5 - scratch.v.y * 0.5) * r.height + r.top - clientY;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best < 0 ? null : best;
  };

  // Pointer: hover reads out, click selects, a drag turns the field. All of it also has DOM controls.
  useEffect(() => {
    const stage = scenes.get('nebula').stage;
    if (!stage) return;
    const s = st.current;
    const wake = () => { s.ambientUntil = Math.max(s.ambientUntil, performance.now() / 1000 + 3); requestFrame('pointer'); };
    const move = (e: PointerEvent) => {
      if (s.down) {
        const dx = e.clientX - s.lastX, dy = e.clientY - s.lastY;
        s.moved += Math.abs(dx) + Math.abs(dy);
        s.lastX = e.clientX; s.lastY = e.clientY;
        if (s.moved > 5) {
          s.dragging = true;
          const v = nebula.get();
          nebula.set({ yaw: v.yaw + dx * 0.008, pitch: Math.max(-1.2, Math.min(1.2, v.pitch + dy * 0.006)) });
          requestFrame('pointer');
        }
        return;
      }
      const hit = e.pointerType === 'touch' ? null : nearest(e.clientX, e.clientY);
      if (hit !== nebula.get().hovered) {
        nebula.set({ hovered: hit });
        latticeHandlers.onHover(hit);
        stage.style.cursor = hit === null ? 'grab' : 'pointer';
        wake();
      }
    };
    const down = (e: PointerEvent) => { s.down = true; s.moved = 0; s.dragging = false; s.lastX = e.clientX; s.lastY = e.clientY; };
    const up = (e: PointerEvent) => {
      const wasDrag = s.dragging;
      s.down = false; s.dragging = false;
      if (wasDrag) return;
      const hit = nearest(e.clientX, e.clientY);
      if (hit !== null) { openTask(tasks[hit].id); wake(); }
    };
    const leave = () => { s.down = false; if (nebula.get().hovered !== null) { nebula.set({ hovered: null }); latticeHandlers.onHover(null); requestFrame('pointer'); } };
    stage.style.cursor = 'grab';
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointerleave', leave);
    return () => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerdown', down);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointerleave', leave);
      stage.style.cursor = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, pos]);

  // Any change of selection, lens or view needs a frame; the eased values then carry themselves.
  useEffect(() => {
    const wake = () => requestFrame('state');
    const a = nebula.subscribe(wake), b = atlas.subscribe(wake);
    st.current.ambientUntil = performance.now() / 1000 + AMBIENT_S;
    requestFrame('mount');
    return () => { a(); b(); scenes.settle('nebula'); nebulaDom.thread?.setAttribute('visibility', 'hidden'); if (nebulaDom.tag) nebulaDom.tag.style.opacity = '0'; };
  }, []);

  useFrame((_, rawDt) => {
    const sp = spin.current, sh = shells.current, pts = points.current;
    if (!sp || !sh || !pts) return;
    if (!scenes.isVisible('nebula')) { scenes.settle('nebula'); return; }
    const dt = Math.min(rawDt, 0.05);
    const s = st.current, v = nebula.get(), at = atlas.get();
    const reduced = ui.get().reducedMotion;
    const now = performance.now() / 1000;
    let busy = false;
    const ease = (cur: number, want: number, rate: number) => {
      const d = want - cur;
      if (Math.abs(d) < 1e-4) return want;
      busy = true;
      return reduced ? want : cur + d * (1 - Math.exp(-dt * rate));
    };

    // Bring the selected bug round when asked.
    const sel = tasks.findIndex((t) => t.id === at.task);
    if (v.focusTick !== s.focusTick) {
      s.focusTick = v.focusTick;
      if (sel >= 0) {
        const f = viewToFront(pos[sel * 3], pos[sel * 3 + 1], pos[sel * 3 + 2]);
        // Take the short way round.
        const turns = Math.round((s.yaw - f.yaw) / (Math.PI * 2));
        nebula.set({ yaw: f.yaw + turns * Math.PI * 2, pitch: f.pitch, zoom: 1.3 });
        return;
      }
    }
    s.yaw = ease(s.yaw, v.yaw, 7);
    s.pitch = ease(s.pitch, v.pitch, 7);
    s.zoom = ease(s.zoom, v.zoom, 7);
    const lensOn = v.lens === 'explore' ? 0 : 1;
    const inspecting = !!at.inspector && at.inspector.kind !== 'evidence';
    s.lens = ease(s.lens, lensOn, 8);
    s.dim = ease(s.dim, inspecting ? 1 : 0, 8);

    // Bounded drift: full speed, then an ease to rest, then nothing renders.
    const left = s.ambientUntil - now;
    if (!reduced && left > 0) {
      s.time += dt * Math.min(1, left / FADE_S);
      busy = true;
    }

    const fit = Math.min(1, size.width / Math.max(1, size.height) / 1.05);
    sp.rotation.set(s.pitch, s.yaw, 0);
    sp.scale.setScalar(s.zoom * fit);
    sh.rotation.set(0, s.time * 0.03, 0);

    const fieldOpacity = 1 - s.dim * 0.55;
    for (const l of parts.layers) {
      for (const m of [l.wireMat, l.fillMat]) {
        const u = m.uniforms;
        u.uTime.value = s.time;
        u.uAmp.value = 1;
        u.uExplode.value = 0;
        u.uOpacity.value = l.opacity * fieldOpacity;
        u.uIntensity.value = 1;
        u.uPointerStr.value = 0;
      }
    }
    parts.coreMat.uniforms.uTime.value = s.time;
    parts.coreMat.uniforms.uIntensity.value = 1;
    parts.haloMat.uniforms.uOpacity.value = fieldOpacity;
    const su = parts.strandMat.uniforms;
    su.uTime.value = s.time; su.uOpacity.value = fieldOpacity; su.uSpread.value = 0; su.uPointerStr.value = 0;
    const du = parts.dustMat.uniforms;
    du.uTime.value = s.time; du.uOpacity.value = fieldOpacity; du.uSpread.value = 0;
    if (halo.current) halo.current.lookAt(camera.position);

    const u = nodeMat.uniforms;
    u.uSel.value = sel;
    u.uHover.value = v.hovered ?? -1;
    u.uLens.value = s.lens;
    u.uDim.value = s.dim;
    u.uPx.value = Math.max(9, Math.min(13, size.height / 40)) * gl.getPixelRatio();
    const arm: ArmId | null = at.condition;
    u.uKind.value = v.lens === 'condition' && arm ? 1 : 0;
    if (arm) tasks.forEach((t, i) => { (u.uCond.value as Float32Array)[i] = t.solved[arm]; });

    // The tag on the selected (or hovered) node, and the thread from it to the inspector.
    const shown = v.hovered ?? sel;
    const tag = nebulaDom.tag, thread = nebulaDom.thread;
    const stage = scenes.get('nebula').stage;
    if (stage && shown >= 0) {
      sp.updateMatrixWorld();
      scratch.v.fromArray(pos, shown * 3).applyMatrix4(pts.matrixWorld).project(camera);
      const x = (scratch.v.x * 0.5 + 0.5) * size.width, y = (0.5 - scratch.v.y * 0.5) * size.height;
      if (tag) {
        tag.textContent = tasks[shown].id.replace(/^tobymao__sqlglot-/, '');
        tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        tag.style.opacity = v.hovered !== null || inspecting ? '1' : '0';
      }
      if (thread) {
        const panel = document.querySelector('.insp');
        const r = stage.getBoundingClientRect();
        if (panel && sel >= 0 && shown === sel && window.innerWidth > 1100) {
          const pr = panel.getBoundingClientRect();
          thread.setAttribute('x1', String(r.left + x)); thread.setAttribute('y1', String(r.top + y));
          thread.setAttribute('x2', String(pr.left)); thread.setAttribute('y2', String(pr.top + 72));
          thread.setAttribute('visibility', 'visible');
        } else thread.setAttribute('visibility', 'hidden');
      }
    }

    if (busy) scenes.animate('nebula'); else scenes.settle('nebula');
  });

  return (
    <>
      <group>
        {!OFF.has('dust') && <points geometry={parts.dust} material={parts.dustMat} frustumCulled={false} />}
        {!OFF.has('core') && <mesh ref={halo} geometry={parts.halo} material={parts.haloMat} renderOrder={1} />}
        <group ref={spin}>
          <group ref={shells}>
            {parts.layers.map((l) => (
              <group key={l.seed} rotation={l.rot as unknown as [number, number, number]}>
                {!OFF.has('fill') && l.seed === LAYERS[0].seed && <mesh geometry={l.fill} material={l.fillMat} renderOrder={2} />}
                {!OFF.has('lines') && <lineSegments geometry={l.wire} material={l.wireMat} renderOrder={3} />}
              </group>
            ))}
            {!OFF.has('strands') && <lineSegments geometry={parts.strands} material={parts.strandMat} renderOrder={4} />}
            <mesh geometry={parts.core} material={parts.coreMat} renderOrder={5} />
          </group>
          <points ref={points} geometry={nodes} material={nodeMat} frustumCulled={false} renderOrder={10} />
        </group>
      </group>
    </>
  );
}
