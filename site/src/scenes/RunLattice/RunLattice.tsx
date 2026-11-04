import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { BoxGeometry, Color, InstancedBufferAttribute, InstancedMesh, MeshStandardMaterial, Object3D, PerspectiveCamera, PlaneGeometry, ShaderChunk, Vector3 } from 'three';
import type { Arm } from '../../data/types';
import { atlas } from '../../state/atlasStore';
import { lattice, latticeHandlers, latticeLabels, latticeScroll, useLattice } from '../../state/latticeStore';
import { requestFrame, scenes } from '../../state/sceneStore';
import { CONDITION_COLOR, INTERFACE, OUTCOME, SPECTRAL } from '../palette';
import { CUBE, LANE, instanceIndex, latticeLayout, outcomeAt } from './layout';

/**
 * The run lattice: every one of the 924 runs as an object. Six lanes (the conditions) run through
 * all 77 bugs; each bug crosses the six lanes, with one cube per repeat. In "outcomes" mode each cube
 * takes its run's real result. Position, count and colour all come from summary.json.
 *
 * Landscape frames show two blocks, test bugs in front and fresh bugs behind, each crossing the six
 * lanes; portrait frames look down the lanes with the bugs receding. A fitted camera frames either.
 *
 * This is scene content only: it renders inside the one shared canvas through a StageView, so here
 * `useThree` reports the stage's size and the lattice's own camera. Nothing is written per frame at
 * rest. Matrices change only during the bounded build-in, and the camera fit and labels only when
 * the camera moved.
 *
 * After the build-in no instance data is uploaded at all. Instance colours hold each run's real
 * outcome and never change. Hover, focus and the design/outcomes view are per-bug uniform arrays read
 * by the vertex shader. Writing the instance buffers after they had been drawn from stalled the GPU
 * process for 100-750 ms. Picking uses the resting matrices.
 */
const COLORS = {
  design: new Color(INTERFACE.text2),   // neutral warm grey: the design view, before outcomes
  solved: new Color(OUTCOME.solved),
  failed: new Color(OUTCOME.failed),
  focus: new Color(INTERFACE.ember),    // the paired bug is a selection, not an outcome
};
/** Lane strip: graphite with a trace of the condition's spectral identity. */
const laneColor = (armId: Arm['id']): Color => new Color(INTERFACE.graphite).lerp(new Color(CONDITION_COLOR[armId]), 0.16);

/** The hover cursor, set on the stage only: cursor is inherited, so setting it on <body> restyles the page. */
const setCursor = (c: string): void => { const el = scenes.get('lattice').stage; if (el && el.style.cursor !== c) el.style.cursor = c; };

const BUILD_DELAY = 0.15, BUILD_STAGGER = 0.018, BUILD_LENGTH = 0.55;

export function RunLatticeScene() {
  const tasks = useLattice((s) => s.tasks);
  const arms = useLattice((s) => s.arms);
  const mode = useLattice((s) => s.mode);
  const reduced = useLattice((s) => s.reduced);
  const mesh = useRef<InstancedMesh>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const wide = size.width / Math.max(1, size.height) >= 0.95;

  const L = useMemo(() => latticeLayout(tasks, arms, wide), [tasks, arms, wide]);
  const { count, lanes, repeats, perBug, blockW, blockSep, span, nTest, laneAt, bugAt } = L;

  const geo = useMemo(() => {
    const g = new BoxGeometry(CUBE, CUBE, CUBE);
    // Which bug each instance belongs to: static, and read by the vertex shader to apply the lift.
    const bug = new Float32Array(count), lane = new Float32Array(count), rep = new Float32Array(count);
    for (let n = 0; n < count; n++) {
      bug[n] = Math.floor(n / perBug);
      lane[n] = Math.floor((n % perBug) / repeats);
      rep[n] = n % repeats;
    }
    g.setAttribute('aBug', new InstancedBufferAttribute(bug, 1));
    g.setAttribute('aLane', new InstancedBufferAttribute(lane, 1));
    g.setAttribute('aRep', new InstancedBufferAttribute(rep, 1));
    return g;
  }, [count, perBug, repeats]);
  const laneGeo = useMemo(() => new PlaneGeometry(LANE - 0.1, span + 0.5), [span]);
  const laneGeoW = useMemo(() => new PlaneGeometry(LANE - 0.1, blockW + 0.45), [blockW]);
  const laneColors = useMemo(() => arms.map((a) => laneColor(a.id)), [arms]);
  useEffect(() => () => { geo.dispose(); laneGeo.dispose(); laneGeoW.dispose(); }, [geo, laneGeo, laneGeoW]);

  // Per-bug animation state, kept outside React so animation never re-renders. `lift`, `design` and
  // `glow` are the uniform arrays themselves: easing a value writes straight into what the shader reads.
  const st = useMemo(() => ({
    outcome: new Float32Array(count * 3),
    lift: new Float32Array(tasks.length),     // how far the bug has risen
    design: new Float32Array(tasks.length),   // 1 = neutral design colour, 0 = the run's real outcome
    glow: new Float32Array(tasks.length),     // 1 = the focused bug in ember
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
    yaw: 0, pitch: 0, el: 0,
    pointer: { x: 0, y: 0 },
  }), [count, tasks.length]);

  const mat = useMemo(() => {
    const m = new MeshStandardMaterial({ roughness: 0.5, metalness: 0.08 });
    const bugs = st.lift.length;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uLift = { value: st.lift };
      shader.uniforms.uDesign = { value: st.design };
      shader.uniforms.uGlow = { value: st.glow };
      shader.uniforms.uDesignColor = { value: COLORS.design };
      shader.uniforms.uFocusColor = { value: COLORS.focus };
      shader.uniforms.uIso = { value: st.iso };
      shader.uniforms.uFade = st.fade;
      shader.vertexShader = `attribute float aBug;
attribute float aLane;
attribute float aRep;
uniform vec3 uIso;
uniform float uFade;
uniform float uLift[${bugs}];
uniform float uDesign[${bugs}];
uniform float uGlow[${bugs}];
uniform vec3 uDesignColor;
uniform vec3 uFocusColor;
` + shader.vertexShader
        .replace('#include <color_vertex>', `#include <color_vertex>
	int bugIndex = int(aBug + 0.5);
	vColor.xyz = mix(mix(vColor.xyz, uDesignColor, uDesign[bugIndex]), uFocusColor, uGlow[bugIndex]);
	bool isoIn = (uIso.x < 0.0 || abs(aBug - uIso.x) < 0.5) && (uIso.y < 0.0 || abs(aLane - uIso.y) < 0.5) && (uIso.z < 0.0 || abs(aRep - uIso.z) < 0.5);
	if (!isoIn) vColor.xyz = mix(vColor.xyz, vec3(0.012), uFade);`)
        .replace('#include <project_vertex>', ShaderChunk.project_vertex.replace(
          'mvPosition = instanceMatrix * mvPosition;',
          'mvPosition = instanceMatrix * mvPosition;\n\tmvPosition.y += uLift[bugIndex];',
        ));
    };
    m.customProgramCacheKey = () => `lattice-lift-${bugs}`;
    return m;
  }, [st]);
  useEffect(() => () => mat.dispose(), [mat]);

  // Scratch objects: no allocation inside the frame callback.
  const scratch = useMemo(() => ({ dummy: new Object3D(), v: new Vector3() }), []);

  // Instance colours: each run's real outcome, written once per data set and never again.
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new Color();
    tasks.forEach((t, i) => arms.forEach((a, r) => {
      for (let k = 0; k < repeats; k++) {
        c.copy(outcomeAt(t, a.id, k) ? COLORS.solved : COLORS.failed);
        c.toArray(st.outcome, instanceIndex(L, i, r, k) * 3);
      }
    }));
    m.instanceColor = new InstancedBufferAttribute(st.outcome, 3);
    m.instanceColor.needsUpdate = true;
  }, [tasks, arms, repeats, L, st]);

  // The view: neutral in design mode, the real result in outcomes mode. Results sweep along the bugs.
  useEffect(() => {
    const now = performance.now() / 1000;
    st.designTarget = mode === 'design' ? 1 : 0;
    for (let i = 0; i < st.switchAt.length; i++) st.switchAt[i] = reduced ? 0 : now + i * 0.012;
    if (st.t0 < 0) st.design.fill(st.designTarget);
    st.colorBusy = true;
    requestFrame('state');
  }, [mode, reduced, st]);

  // The pointer turns the camera slightly, but only while the lattice is on screen.
  useEffect(() => {
    if (reduced) return;
    const onMove = (e: PointerEvent) => {
      st.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      st.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
      if (scenes.isVisible('lattice')) requestFrame('pointer');
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [st, reduced]);

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

    // Camera: orbits the lattice centre. It rises toward a plan view as the hero scrolls away, and the
    // pointer turns it slightly. Wide frames use a three-quarter view from the front right.
    const k = 1 - Math.exp(-dt * 5);
    const yawT = (wide ? -0.22 : 0) + (reduced ? 0 : st.pointer.x * 0.16);
    const pitchT = reduced ? 0 : -st.pointer.y * 0.05;
    const elT = (wide ? 0.86 : 0.62) + latticeScroll.value * 0.38;
    if (st.el === 0) { st.el = elT; st.yaw = yawT; st.camDirty = true; }
    const camOff = Math.abs(yawT - st.yaw) + Math.abs(pitchT - st.pitch) + Math.abs(elT - st.el);
    if (camOff > 1e-4) {
      st.yaw += (yawT - st.yaw) * k;
      st.pitch += (pitchT - st.pitch) * k;
      st.el += (elT - st.el) * k;
      st.camDirty = true;
      busy = true;
    }

    if (st.camDirty) {
      st.camDirty = false;
      const v = scratch.v;
      const el = st.el + st.pitch;
      const R = wide ? blockW * 1.5 : span * 0.72;
      camera.position.set(Math.sin(st.yaw) * Math.cos(el) * R, Math.sin(el) * R, Math.cos(st.yaw) * Math.cos(el) * R);
      camera.lookAt(0, 0, 0);

      // Fit: project the lattice's corners and choose a view window that frames them, leaving room for
      // the labels (left of the lanes when wide, below them when tall).
      camera.clearViewOffset();
      camera.updateMatrixWorld();
      const halfL = (lanes * LANE) / 2;
      const halfB = wide ? blockW / 2 + 0.1 : span / 2 + 0.1;
      const halfA = wide ? blockSep / 2 + halfL : halfL;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const b of [-halfB, halfB]) for (const l of [-halfA, halfA]) for (const y of [0, CUBE + 0.32]) {
        if (wide) v.set(b, y, l); else v.set(l, y, -b);
        v.project(camera);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      const W = size.width, H = size.height;
      const fx = wide ? 0.72 : 0.94, cxF = wide ? 0.6 : 0.5;
      const fy = wide ? 0.84 : 0.8, cyF = wide ? 0.52 : 0.44;
      const s = Math.min((2 * fx) / (x1 - x0), (2 * fy) / (y1 - y0));
      const w = W / s, h = H / s;
      const cxPx = (((x0 + x1) / 2 + 1) / 2) * W;
      const cyPx = ((1 - (y0 + y1) / 2) / 2) * H;
      camera.setViewOffset(W, H, cxPx - w * cxF, cyPx - h * cyF, w, h);

      // Project the DOM labels.
      const labels = latticeLabels;
      const place = (node: HTMLElement | null | undefined, x: number, y: number, zz: number) => {
        if (!node) return;
        v.set(x, y, zz).project(camera);
        node.style.transform = `translate(${((v.x + 1) / 2) * W}px, ${((1 - v.y) / 2) * H}px)`;
        node.style.opacity = v.z < 1 ? '' : '0';
      };
      const back = lanes + 2;
      if (wide) {
        const left = -blockW / 2 - 0.26;
        for (let r = 0; r < lanes; r++) place(labels[r], left, 0, blockSep / 2 + laneAt(r));
        for (let r = 0; r < lanes; r++) place(labels[back + r], left, 0, -blockSep / 2 + laneAt(r));
        place(labels[lanes], -blockW / 2, 0, blockSep / 2 + laneAt(0) - LANE * 1.25);
        place(labels[lanes + 1], -blockW / 2, 0, -blockSep / 2 + laneAt(0) - LANE * 1.25);
      } else {
        for (let r = 0; r < lanes; r++) place(labels[r], laneAt(r), 0, -bugAt(0) + 0.42);
        for (let r = 0; r < lanes; r++) { const n = labels[back + r]; if (n) n.style.opacity = '0'; }
        place(labels[lanes], laneAt(lanes - 1) + LANE * 0.7, 0, -bugAt(0) - 0.6);
        place(labels[lanes + 1], laneAt(lanes - 1) + LANE * 0.7, 0, -bugAt(nTest));
      }
    }

    // Isolation: everything outside the chosen bug, condition and repeat recedes. Uniforms only.
    {
      const at = atlas.get(), lat = lattice.get();
      const lane = at.condition ? arms.findIndex((a) => a.id === at.condition) : -1;
      const rep = at.repeat ?? -1, bug = lat.isolateBug ? focused : -1;
      if (lane >= 0 || rep >= 0 || bug >= 0) st.iso.set(bug, lane, rep);
      const want = lane >= 0 || rep >= 0 || bug >= 0 ? 0.9 : 0;
      const d = want - st.fade.value;
      if (Math.abs(d) > 2e-3) { st.fade.value = reduced ? want : st.fade.value + d * (1 - Math.exp(-dt * 9)); busy = true; } else st.fade.value = want;
    }

    const buildEnd = reduced ? 0 : BUILD_DELAY + (tasks.length - 1) * BUILD_STAGGER + BUILD_LENGTH;
    const building = since < buildEnd;
    // The last build-in frame stops just short of rest: write the settled state once.
    if (!building && !st.built) { st.built = true; st.matricesDirty = true; }

    /** Writes one bug's contiguous block of matrices. `b` is its build-in progress. */
    const writeBug = (i: number, e: number) => {
      const { dummy } = scratch;
      for (let n = i * perBug, end = n + perBug; n < end; n++) {
        dummy.position.set(L.xz[n * 2], CUBE / 2 + (1 - e) * 2.2, L.xz[n * 2 + 1]);
        dummy.scale.setScalar(0.001 + e);
        dummy.updateMatrix();
        m.setMatrixAt(n, dummy.matrix);
      }
    };

    // Lift and focus: the hovered or focused bug rises out of the lattice, across all six lanes at once,
    // and in design mode the focused bug turns ember. Only uniform arrays change.
    const glowRate = 1 - Math.exp(-dt * (reduced ? 1000 : 9));
    for (let i = 0; i < tasks.length; i++) {
      const glowWant = st.designTarget === 1 && i === focused ? 1 : 0;
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
    e.instanceId === undefined ? null : Math.floor(e.instanceId / (lanes * repeats));

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 7, 5]} intensity={1.5} />
      <directionalLight position={[-4, 3, -6]} intensity={0.45} color={SPECTRAL.amber} />
      {wide
        ? [blockSep / 2, -blockSep / 2].flatMap((zb) => arms.map((a, r) => (
          <mesh key={a.id + String(zb)} geometry={laneGeoW} rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[0, -0.002, zb + laneAt(r)]}>
            <meshBasicMaterial color={laneColors[r]} />
          </mesh>
        )))
        : arms.map((a, r) => (
          <mesh key={a.id} geometry={laneGeo} rotation={[-Math.PI / 2, 0, 0]} position={[laneAt(r), -0.002, 0]}>
            <meshBasicMaterial color={laneColors[r]} />
          </mesh>
        ))}
      <instancedMesh ref={mesh} args={[geo, mat, count]}
        onPointerMove={(e) => { e.stopPropagation(); const i = bugOf(e); if (i !== lattice.get().hovered) latticeHandlers.onHover(i); setCursor('pointer'); }}
        onPointerOut={() => { latticeHandlers.onHover(null); setCursor(''); }}
        onClick={(e) => { e.stopPropagation(); const i = bugOf(e); if (i !== null) latticeHandlers.onPick(i); }} />
    </>
  );
}
