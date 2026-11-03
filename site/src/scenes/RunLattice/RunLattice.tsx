import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { BoxGeometry, Color, InstancedMesh, MeshStandardMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Vector3 } from 'three';
import type { Arm, TaskMeta } from '../../data/types';

/**
 * The run lattice: every one of the 924 runs as an object. Six lanes (the conditions) run through
 * all 77 bugs; each bug crosses the six lanes, with one cube per repeat. In "outcomes" mode each cube
 * takes its run's real result. Position, count and colour all come from summary.json.
 *
 * Landscape frames show two blocks, test bugs in front and fresh bugs behind, each crossing the six
 * lanes; portrait frames look down the lanes with the bugs receding. A fitted camera frames either.
 */
export type LatticeMode = 'design' | 'outcomes';

export interface LatticeProps {
  tasks: TaskMeta[];          // test bugs first, then fresh
  arms: Arm[];
  mode: LatticeMode;
  focus: number;              // bug index shown in the readout (hovered or stepped to)
  hovered: number | null;
  onHover: (i: number | null) => void;
  onPick: (i: number) => void;
  reduced: boolean;
  /** Projected DOM labels: one per lane, the two bug-group labels, then lane numbers for the back block. */
  labels: MutableRefObject<(HTMLElement | null)[]>;
  /** 0..1 progress of the hero scrolling out, written by the parent. */
  scroll: MutableRefObject<number>;
  onReady: () => void;
}

const LANE = 0.52;       // lane pitch
const BUG = 0.21;        // bug pitch
const GROUP_GAP = 0.7;   // gap between test and fresh bugs
const CUBE = 0.15;
const REP = 0.095;       // repeat offset across a lane

const COLORS = {
  design: new Color('#8592a6'),
  solved: new Color('#37b597'),
  failed: new Color('#d8665e'),
  focus: new Color('#8fabff'),
};

function Lattice(p: LatticeProps) {
  const { tasks, arms, mode, focus, hovered, onHover, onPick, reduced, labels, scroll, onReady } = p;
  const mesh = useRef<InstancedMesh>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const wide = size.width / Math.max(1, size.height) >= 0.95;

  const nTest = tasks.filter((t) => t.set === 'test').length;
  const repeats = Math.round(arms[0].attempts / tasks.length);
  const count = tasks.length * arms.length * repeats;
  const span = (tasks.length - 1) * BUG + GROUP_GAP;
  /** Position of bug i along the bug axis, centred. */
  const bugAt = (i: number) => i * BUG + (i >= nTest ? GROUP_GAP : 0) - span / 2;
  /** Position of lane r across the lanes, centred. */
  const laneAt = (r: number) => (r - (arms.length - 1) / 2) * LANE;
  // Landscape: two blocks (test in front, fresh behind), bugs along x within each block.
  const blockW = (Math.max(nTest, tasks.length - nTest) - 1) * BUG;
  const blockSep = arms.length * LANE + 0.9;
  const blockX = (i: number) => (i >= nTest ? i - nTest : i) * BUG - blockW / 2;
  const blockZ = (i: number) => (i >= nTest ? -blockSep / 2 : blockSep / 2);
  /** World x/z of a run. */
  const xz = (i: number, r: number, q: number): [number, number] => {
    const across = laneAt(r) + (q - (repeats - 1) / 2) * REP * 2;
    return wide ? [blockX(i), blockZ(i) + across] : [across, -bugAt(i)];
  };

  const geo = useMemo(() => new BoxGeometry(CUBE, CUBE, CUBE), []);
  const mat = useMemo(() => new MeshStandardMaterial({ roughness: 0.5, metalness: 0.08 }), []);
  const laneGeo = useMemo(() => new PlaneGeometry(LANE - 0.1, span + 0.5), [span]);
  const laneGeoW = useMemo(() => new PlaneGeometry(LANE - 0.1, blockW + 0.45), [blockW]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); laneGeo.dispose(); laneGeoW.dispose(); }, [geo, mat, laneGeo, laneGeoW]);

  // Per-run state, kept outside React so animation never re-renders.
  const st = useMemo(() => ({
    cur: new Float32Array(count * 3),
    target: new Float32Array(count * 3),
    switchAt: new Float32Array(count),
    lift: new Float32Array(tasks.length),
    t0: -1,
    ready: false,
    yaw: 0, pitch: 0, el: 0,
    pointer: { x: 0, y: 0 },
  }), [count, tasks.length]);

  const index = (i: number, r: number, k: number) => (i * arms.length + r) * repeats + k;

  // Targets: neutral in design mode (the focused bug in blue, so one bug reads across all six lanes);
  // the run's real result in outcomes mode.
  useEffect(() => {
    const now = performance.now() / 1000;
    const c = new Color();
    tasks.forEach((t, i) => {
      arms.forEach((a, r) => {
        const solved = t.solved[a.id];
        for (let k = 0; k < repeats; k++) {
          const n = index(i, r, k);
          if (mode === 'design') c.copy(i === focus ? COLORS.focus : COLORS.design);
          else c.copy(k < solved ? COLORS.solved : COLORS.failed);
          c.toArray(st.target, n * 3);
          // Results sweep along the bugs.
          st.switchAt[n] = reduced ? 0 : now + i * 0.012 + r * 0.02;
        }
      });
    });
    if (st.t0 < 0) st.cur.set(st.target);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, focus, tasks, arms, reduced]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      st.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      st.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
      invalidate();
    };
    const onScroll = () => invalidate();
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('scroll', onScroll); };
  }, [st, invalidate]);

  useEffect(() => { labels.current.forEach((el) => { if (el) el.dataset.orient = wide ? 'wide' : 'tall'; }); invalidate(); }, [wide, labels, invalidate]);

  const dummy = useMemo(() => new Object3D(), []);
  const color = useMemo(() => new Color(), []);
  const v = useMemo(() => new Vector3(), []);

  useFrame((state, dtRaw) => {
    const m = mesh.current;
    if (!m) return;
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
    const elT = (wide ? 0.86 : 0.62) + scroll.current * 0.38;
    if (st.el === 0) { st.el = elT; st.yaw = yawT; }
    st.yaw += (yawT - st.yaw) * k;
    st.pitch += (pitchT - st.pitch) * k;
    st.el += (elT - st.el) * k;
    if (Math.abs(yawT - st.yaw) + Math.abs(pitchT - st.pitch) + Math.abs(elT - st.el) > 1e-4) busy = true;
    const el = st.el + st.pitch;
    const R = wide ? blockW * 1.5 : span * 0.72;
    camera.position.set(Math.sin(st.yaw) * Math.cos(el) * R, Math.sin(el) * R, Math.cos(st.yaw) * Math.cos(el) * R);
    camera.lookAt(0, 0, 0);

    // Fit: project the lattice's corners and choose a view window that frames them, leaving room for
    // the labels (left of the lanes when wide, below them when tall).
    camera.clearViewOffset();
    camera.updateMatrixWorld();
    const halfL = (arms.length * LANE) / 2;
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

    // Lift: the hovered or focused bug rises out of the lattice, across all six lanes at once.
    for (let i = 0; i < tasks.length; i++) {
      const want = i === hovered ? 0.3 : i === focus ? 0.18 : 0;
      const d = want - st.lift[i];
      if (Math.abs(d) > 1e-3) { st.lift[i] += d * (1 - Math.exp(-dt * 10)); busy = true; } else st.lift[i] = want;
    }

    for (let i = 0; i < tasks.length; i++) {
      // Build-in: bugs drop into place one after another.
      const b = reduced ? 1 : Math.min(1, Math.max(0, (since - 0.15 - i * 0.018) / 0.55));
      const e = 1 - Math.pow(1 - b, 3);
      if (b < 1) busy = true;
      for (let r = 0; r < arms.length; r++) {
        for (let q = 0; q < repeats; q++) {
          const n = index(i, r, q);
          const [px, pz] = xz(i, r, q);
          dummy.position.set(px, CUBE / 2 + st.lift[i] + (1 - e) * 2.2, pz);
          dummy.scale.setScalar(0.001 + e);
          dummy.updateMatrix();
          m.setMatrixAt(n, dummy.matrix);
          if (now >= st.switchAt[n]) {
            const o = n * 3;
            const a = 1 - Math.exp(-dt * (reduced ? 1000 : 9));
            for (let c = 0; c < 3; c++) {
              const dd = st.target[o + c] - st.cur[o + c];
              if (Math.abs(dd) > 2e-3) { st.cur[o + c] += dd * a; busy = true; } else st.cur[o + c] = st.target[o + c];
            }
          } else busy = true;
          color.fromArray(st.cur, n * 3);
          m.setColorAt(n, color);
        }
      }
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;

    // Project the DOM labels.
    const place = (node: HTMLElement | null | undefined, x: number, y: number, zz: number) => {
      if (!node) return;
      v.set(x, y, zz).project(camera);
      node.style.transform = `translate(${((v.x + 1) / 2) * W}px, ${((1 - v.y) / 2) * H}px)`;
      node.style.opacity = v.z < 1 ? '' : '0';
    };
    const back = arms.length + 2;
    if (wide) {
      const left = -blockW / 2 - 0.26;
      arms.forEach((_, r) => place(labels.current[r], left, 0, blockSep / 2 + laneAt(r)));
      arms.forEach((_, r) => place(labels.current[back + r], left, 0, -blockSep / 2 + laneAt(r)));
      place(labels.current[arms.length], -blockW / 2, 0, blockSep / 2 + laneAt(0) - LANE * 1.25);
      place(labels.current[arms.length + 1], -blockW / 2, 0, -blockSep / 2 + laneAt(0) - LANE * 1.25);
    } else {
      arms.forEach((_, r) => place(labels.current[r], laneAt(r), 0, -bugAt(0) + 0.42));
      arms.forEach((_, r) => { const n = labels.current[back + r]; if (n) n.style.opacity = '0'; });
      place(labels.current[arms.length], laneAt(arms.length - 1) + LANE * 0.7, 0, -bugAt(0) - 0.6);
      place(labels.current[arms.length + 1], laneAt(arms.length - 1) + LANE * 0.7, 0, -bugAt(nTest));
    }

    const buildEnd = reduced ? 0 : 0.15 + (tasks.length - 1) * 0.018 + 0.55;
    if (!st.ready) { if (since >= buildEnd) { st.ready = true; onReady(); } else busy = true; }
    if (busy) state.invalidate();
  });

  const bugOf = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    e.instanceId === undefined ? null : Math.floor(e.instanceId / (arms.length * repeats));

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 7, 5]} intensity={1.5} />
      <directionalLight position={[-4, 3, -6]} intensity={0.45} color="#7d9cf2" />
      {wide
        ? [blockSep / 2, -blockSep / 2].flatMap((zb) => arms.map((a, r) => (
          <mesh key={a.id + String(zb)} geometry={laneGeoW} rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[0, -0.002, zb + laneAt(r)]}>
            <meshBasicMaterial color="#18202a" />
          </mesh>
        )))
        : arms.map((a, r) => (
          <mesh key={a.id} geometry={laneGeo} rotation={[-Math.PI / 2, 0, 0]} position={[laneAt(r), -0.002, 0]}>
            <meshBasicMaterial color="#18202a" />
          </mesh>
        ))}
      <instancedMesh ref={mesh} args={[geo, mat, count]}
        onPointerMove={(e) => { e.stopPropagation(); const i = bugOf(e); if (i !== hovered) onHover(i); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { onHover(null); document.body.style.cursor = ''; }}
        onClick={(e) => { e.stopPropagation(); const i = bugOf(e); if (i !== null) onPick(i); }} />
    </>
  );
}

export default function RunLattice(props: LatticeProps) {
  return (
    <Canvas
      className="lattice__canvas"
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: 34, position: [0, 4, 10], near: 0.1, far: 120 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
    >
      <Lattice {...props} />
    </Canvas>
  );
}
