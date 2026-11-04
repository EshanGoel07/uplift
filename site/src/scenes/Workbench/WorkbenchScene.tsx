import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  BoxGeometry, Color, EdgesGeometry, Group, InstancedMesh, LineBasicMaterial, LineDashedMaterial, MathUtils, Matrix4, Mesh,
  MeshStandardMaterial, Object3D, PerspectiveCamera, Plane, TorusGeometry, Vector3, BufferGeometry, Float32BufferAttribute,
} from 'three';
import type { ArmId, Summary } from '../../data/types';
import { CONDITIONS } from '../../data/method';
import { requestFrame, scenes, ui } from '../../state/sceneStore';
import { sideOf, wb, wbLabels, workbenchBounds, type Focus } from '../../state/workbenchStore';
import { BACK, BOARD_CENTRE, BOUNDS, LANES, MODULE_LABELS, POSES, X, Z, fitToStage, laneLabelAt, laneZ, repZ, type Pose } from './layout';
import { atlas } from '../../state/atlasStore';
import { workspaceLayers } from '../../data/method';
import { CONDITION_COLOR, INTERFACE, OUTCOME, SPECTRAL } from '../palette';

/**
 * The experimental workbench: the real architecture of the 924-run study as a model on a board.
 *   A task source (77 main bugs in two groups; the 40 dev tasks on a separate tray)
 *   B six condition lanes, each with its setup module and two repeat channels
 *   C twelve isolated workspaces for the selected bug
 *   D the information barrier: only the patch passes through
 *   E the evaluator with the hidden tests
 *   F the paired analysis for the selected bug
 * Every count comes from summary.json; run outcomes come from the selected task's file.
 */

// Every colour comes from the shared palette (scenes/palette.ts = styles/tokens.css).
// Structure is dark ceramic in the Nebula's language, with fine spectral edges; ember marks the selection; the six conditions carry their
// spectral identity; outcomes use the semantic solved / failed / mixed colours.
const C = {
  board: INTERFACE.graphite, plate: INTERFACE.border, plate2: INTERFACE.border, rail: INTERFACE.text3, edge: INTERFACE.text3,
  test: INTERFACE.text, fresh: INTERFACE.text2, dev: INTERFACE.text3, pick: INTERFACE.ember, laneOn: INTERFACE.burnt,
  tips: INTERFACE.text2, generic: INTERFACE.text3, hook: INTERFACE.text3, devLine: SPECTRAL.amber,
  glass: SPECTRAL.violet, glassEdge: SPECTRAL.blue, snapshot: INTERFACE.text3, issue: SPECTRAL.amber, patch: INTERFACE.ember,
  wall: SPECTRAL.violet, tests: INTERFACE.text, solved: OUTCOME.solved, failed: OUTCOME.failed, unknown: INTERFACE.border,
  half: OUTCOME.mixed,
};

type Zone = 'agent' | 'eval' | 'neutral';
interface Mats { [k: string]: MeshStandardMaterial }

/** The four planes through the camera and the stage's edges: a zoomed model never draws outside its stage. */
const CLIP = [new Plane(), new Plane(), new Plane(), new Plane()];
const MAX_LAYERS = 8;

function makeMats(): Record<Zone, Mats> {
  const mk = (hex: string, o = 1) => new MeshStandardMaterial({ color: hex, roughness: 0.42, metalness: 0.28, transparent: true, opacity: o, clippingPlanes: CLIP });
  const zone = (): Mats => ({
    plate: mk(C.plate), plate2: mk(C.plate2), rail: mk(C.rail), tips: mk(C.tips), generic: mk(C.generic), hook: mk(C.hook),
    glass: mk(C.glass, 0.16), board: mk(C.board), laneOn: mk(C.laneOn), snapshot: mk(C.snapshot), issue: mk(C.issue), patch: mk(C.patch), tests: mk(C.tests),
    pick: mk(C.pick), lamp: mk(C.unknown),
    // One identity material per condition, so the barrier switch dims them with their side.
    ...Object.fromEntries(Object.entries(CONDITION_COLOR).map(([id, hex]) => [`cond_${id}`, mk(hex)])),
  });
  return { agent: zone(), eval: zone(), neutral: zone() };
}

const tmpV = new Vector3();

// Shared geometry for the whole scene (module singletons: the scene mounts once per page).
const BOX = new BoxGeometry(1, 1, 1);
const EDGES = new EdgesGeometry(BOX);
const RING = new TorusGeometry(0.13, 0.035, 10, 28);

type V3 = [number, number, number];
function Box({ p, s, m, ...rest }: { p: V3; s: V3; m: MeshStandardMaterial } & Record<string, unknown>) {
  return <mesh geometry={BOX} material={m} position={p} scale={s} {...rest} />;
}

interface Props { summary: Summary }

export function WorkbenchScene({ summary }: Props) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const outer = useRef<Group>(null);
  const inner = useRef<Group>(null);

  const tasks = useMemo(
    () => [...summary.tasks.filter((t) => t.set === 'test'), ...summary.tasks.filter((t) => t.set === 'fresh')],
    [summary],
  );
  const arms = summary.arms;
  const nTest = tasks.filter((t) => t.set === 'test').length;
  const repeats = Math.round(arms[0].attempts / tasks.length);

  // Shared geometry and materials (one set per zone so the barrier switch can dim a whole side).
  const G = { box: BOX, edges: EDGES, ring: RING };
  const M = useMemo(makeMats, []);
  const edgeMat = useMemo(() => ({
    agent: new LineBasicMaterial({ color: C.glassEdge, transparent: true, opacity: 0.85, clippingPlanes: CLIP }),
    pick: new LineBasicMaterial({ color: C.pick, transparent: true, opacity: 1, clippingPlanes: CLIP }),
    wall: new LineBasicMaterial({ color: C.wall, transparent: true, opacity: 0.9, clippingPlanes: CLIP }),
  }), []);
  const devLine = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([X.dev + 1.2, 0.06, Z.devTray, X.setup, 0.06, Z.devTray, X.setup, 0.06, laneZ(LANES - 1) + 0.45], 3));
    const m = new LineDashedMaterial({ color: C.devLine, dashSize: 0.14, gapSize: 0.1, transparent: true, opacity: 0.9, clippingPlanes: CLIP });
    return { g, m };
  }, []);
  useEffect(() => {
    devLine.g.computeBoundingSphere();
    return () => {
      Object.values(M).forEach((z) => Object.values(z).forEach((m) => m.dispose()));
      Object.values(edgeMat).forEach((m) => m.dispose());
      devLine.g.dispose(); devLine.m.dispose();
    };
  }, [M, edgeMat, devLine]);

  // Task tiles: two instanced sets (main and dev), coloured by group, the selected bug in blue.
  const tiles = useRef<InstancedMesh>(null);
  const devTiles = useRef<InstancedMesh>(null);
  const tileMat = useMemo(() => new MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, transparent: true, clippingPlanes: CLIP }), []);
  const devMat = useMemo(() => new MeshStandardMaterial({ color: C.dev, roughness: 0.7, transparent: true, opacity: 0.9, clippingPlanes: CLIP }), []);
  useEffect(() => () => { tileMat.dispose(); devMat.dispose(); }, [tileMat, devMat]);
  const tilePos = (i: number): [number, number] => {
    const fresh = i >= nTest;
    const j = fresh ? i - nTest : i;
    const col = j % 3, row = Math.floor(j / 3);
    return [X.tray - 0.95 + col * 0.3 + (fresh ? 1.12 : 0), -1.8 + row * 0.3];
  };
  useEffect(() => {
    const m = tiles.current, d = devTiles.current;
    if (!m || !d) return;
    const o = new Object3D();
    tasks.forEach((_, i) => {
      const [x, z] = tilePos(i);
      o.position.set(x, 0.1, z); o.scale.set(0.22, 0.06, 0.22); o.updateMatrix(); m.setMatrixAt(i, o.matrix);
    });
    for (let i = 0; i < 40; i++) {
      o.position.set(X.dev - 0.91 + (i % 8) * 0.26, 0.09, Z.devTray - 0.39 + Math.floor(i / 8) * 0.26);
      o.scale.set(0.18, 0.05, 0.18); o.updateMatrix(); d.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true; d.instanceMatrix.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  // Selection-driven state (read every frame from the store; React never re-renders the scene).
  const dim = useRef({ agent: 1, eval: 1 });
  const lastTask = useRef(-1);
  const lampMats = useMemo(() => Array.from({ length: LANES * 2 }, () => new MeshStandardMaterial({ color: C.unknown, roughness: 0.4, transparent: true, clippingPlanes: CLIP })), []);
  const barMats = useMemo(() => Array.from({ length: LANES }, () => new MeshStandardMaterial({ color: C.unknown, roughness: 0.5, transparent: true, clippingPlanes: CLIP })), []);
  const bars = useRef<(Mesh | null)[]>([]);
  const baseline = useRef<Mesh>(null);
  const laneMeshes = useRef<(Mesh | null)[]>([]);
  const wsEdges = useRef<(Object3D | null)[]>([]);
  useEffect(() => () => { lampMats.forEach((m) => m.dispose()); barMats.forEach((m) => m.dispose()); }, [lampMats, barMats]);

  // Any selection or view change needs one frame; the labels may have re-mounted, so refit too.
  const fit = useRef({ dirty: true, stage: null as HTMLElement | null, l: 0, t: 0, w: 0, h: 0, aspect: 0 });
  useEffect(() => wb.subscribe(() => { fit.current.dirty = true; requestFrame('state'); }), []);
  useEffect(() => atlas.subscribe(() => requestFrame('state')), []);
  const gl = useThree((s) => s.gl);
  useEffect(() => { gl.localClippingEnabled = true; }, [gl]);
  const pose = useRef<Pose>({ ...POSES.full });
  const explodeT = useRef(0);
  const glassT = useRef(0.16);
  const layerMeshes = useRef<(Mesh | null)[]>([]);
  const scratchV = useMemo(() => ({ a: new Vector3(), b: new Vector3(), c: new Vector3(), d: new Vector3(), e: new Vector3() }), []);
  // Mounting can follow the visibility flip, so the first frame has to be asked for here.
  useEffect(() => {
    scenes.setMounted('workbench', true);
    requestFrame('mount');
    return () => { scenes.settle('workbench'); scenes.setMounted('workbench', false); };
  }, []);

  const corners = useMemo(() => {
    const out: Vector3[] = [];
    for (const x of [BOUNDS.x0, BOUNDS.x1]) for (const y of [BOUNDS.y0, BOUNDS.y1]) for (const z of [BOUNDS.z0, BOUNDS.z1]) out.push(new Vector3(x, y, z));
    return out;
  }, []);
  // Scratch objects, so the frame callback allocates nothing.
  const rot = useMemo(() => new Matrix4(), []);
  const rotY = useMemo(() => new Matrix4(), []);
  const rotated = useMemo(() => new Float64Array(corners.length * 3), [corners]);
  const color = useMemo(() => new Color(), []);
  const lastFocus = useRef<Focus | null>(null);
  // Materials per barrier side as flat lists, with the opacity each one rests at.
  const zoneMats = useMemo(() => ({
    agent: Object.entries(M.agent).map(([name, m]) => ({ m, base: name === 'glass' ? 0.16 : 1 })),
    eval: Object.entries(M.eval).map(([name, m]) => ({ m, base: name === 'glass' ? 0.16 : 1 })),
  }), [M]);
  const appliedDim = useRef({ agent: -1, eval: -1 });

  useFrame((_, rawDt) => {
    const o = outer.current, g = inner.current;
    if (!o || !g) return;
    const s = wb.get();
    const entry = scenes.get('workbench');
    o.visible = entry.visible && s.view === '3d' && !!entry.stage;
    if (!o.visible || !entry.stage) { scenes.settle('workbench'); return; }
    const r = entry.stage.getBoundingClientRect();
    const dt = Math.min(rawDt, 0.05);
    const reduced = ui.get().reducedMotion;
    let busy = false;

    // Fit the board into the DOM stage: a fixed three-quarter view, scaled to the stage rect. Refit
    // only when the stage moved or resized (it moves with the page; the camera does not).
    const f0 = fit.current;
    const want0 = POSES[s.preset], p0 = pose.current;
    let posed = false;
    for (const k of ['tilt', 'yaw', 'zoom', 'x', 'z'] as const) {
      const d = want0[k] - p0[k];
      if (Math.abs(d) < 1e-3) { if (d !== 0) { p0[k] = want0[k]; posed = true; } continue; }
      p0[k] = reduced ? want0[k] : p0[k] + d * (1 - Math.exp(-dt * 6));
      posed = true; busy = true;
    }
    const refit = posed || f0.dirty || f0.stage !== entry.stage || f0.l !== r.left || f0.t !== r.top || f0.w !== r.width || f0.h !== r.height || f0.aspect !== camera.aspect;
    if (refit) {
      const { tilt, yaw } = p0;
      g.rotation.set(0, yaw, 0);
      o.rotation.set(tilt, 0, 0);
      rot.makeRotationX(tilt).multiply(rotY.makeRotationY(yaw));
      corners.forEach((c, i) => { tmpV.copy(c).applyMatrix4(rot); rotated[i * 3] = tmpV.x; rotated[i * 3 + 1] = tmpV.y; rotated[i * 3 + 2] = tmpV.z; });
      // Drawn BACK units behind the z = 0 plane and scaled up to match, so perspective stays gentle
      // (a measured three-quarter view rather than a wide-angle one).
      const fitted = fitToStage(rotated,
        { tanHalfFov: Math.tan(MathUtils.degToRad(camera.fov / 2)), aspect: camera.aspect, z: camera.position.z },
        { left: r.left, top: r.top, width: r.width, height: r.height, vw: window.innerWidth, vh: window.innerHeight });
      // Zoom about the pose's focus point; at the full view this is exactly the fit.
      const sc = fitted.scale * p0.zoom, V = scratchV;
      V.a.set(BOARD_CENTRE.x, 0, BOARD_CENTRE.z).applyMatrix4(rot);
      V.b.set(p0.x, 0, p0.z).applyMatrix4(rot);
      o.scale.setScalar(sc);
      o.position.set(fitted.x + V.a.x * fitted.scale - V.b.x * sc, fitted.y + V.a.y * fitted.scale - V.b.y * sc, -BACK);
      // Clip to the stage: planes through the camera and the stage's edges on the z = 0 plane.
      const hh = Math.tan(MathUtils.degToRad(camera.fov / 2)) * camera.position.z, hw = hh * camera.aspect;
      const ex = (px: number) => ((px / window.innerWidth) * 2 - 1) * hw, ey = (py: number) => (1 - (py / window.innerHeight) * 2) * hh;
      const l = ex(r.left), rr = ex(r.right), t = ey(r.top), bt = ey(r.bottom);
      V.c.copy(camera.position);
      const setPlane = (i: number, ax: number, ay: number, bx: number, by: number) => {
        CLIP[i].setFromCoplanarPoints(V.c, V.d.set(ax, ay, 0), V.e.set(bx, by, 0));
        if (CLIP[i].distanceToPoint(V.d.set((l + rr) / 2, (t + bt) / 2, 0)) < 0) CLIP[i].negate();
      };
      setPlane(0, l, bt, l, t); setPlane(1, rr, bt, rr, t); setPlane(2, l, t, rr, t); setPlane(3, l, bt, rr, bt);
      workbenchBounds.left = fitted.left - r.left; workbenchBounds.right = fitted.right - r.left;
      workbenchBounds.top = fitted.top - r.top; workbenchBounds.bottom = fitted.bottom - r.top;
      workbenchBounds.stageWidth = r.width; workbenchBounds.stageHeight = r.height;
      f0.dirty = false; f0.stage = entry.stage; f0.l = r.left; f0.t = r.top; f0.w = r.width; f0.h = r.height; f0.aspect = camera.aspect;
    }

    // Barrier switch: the side that is not being looked at fades back.
    const side = sideOf(s.focus);
    const wantAgent = side === 'evaluator' ? 0.3 : 1, wantEval = side === 'agent' ? 0.3 : 1;
    const easeDim = (cur: number, want: number) => {
      const d = want - cur;
      if (Math.abs(d) <= 0.004) return want;
      busy = true;
      return reduced ? want : cur + d * (1 - Math.exp(-dt * 8));
    };
    dim.current.agent = easeDim(dim.current.agent, wantAgent);
    dim.current.eval = easeDim(dim.current.eval, wantEval);
    // Opacities are written only while a side's dim value changes.
    if (appliedDim.current.agent !== dim.current.agent) {
      appliedDim.current.agent = dim.current.agent;
      for (const z of zoneMats.agent) z.m.opacity = z.base * dim.current.agent;
      tileMat.opacity = dim.current.agent; devMat.opacity = 0.9 * dim.current.agent;
      edgeMat.agent.opacity = 0.85 * dim.current.agent;
    }
    if (appliedDim.current.eval !== dim.current.eval) {
      appliedDim.current.eval = dim.current.eval;
      for (const z of zoneMats.eval) z.m.opacity = z.base * dim.current.eval;
      for (const m of lampMats) m.opacity = dim.current.eval;
      for (const m of barMats) m.opacity = dim.current.eval;
    }

    // The barrier cutaway makes the wall solid enough to read as a physical boundary.
    const glassWant = s.cutaway ? 0.55 : 0.16;
    if (Math.abs(glassWant - glassT.current) > 1e-3) { glassT.current += (glassWant - glassT.current) * (reduced ? 1 : 1 - Math.exp(-dt * 8)); busy = true; } else glassT.current = glassWant;
    M.neutral.glass.opacity = glassT.current;

    // The exploded workspace: its layers separate along y, and reassemble.
    const armSel: ArmId = atlas.get().condition ?? 'both';
    const stack = workspaceLayers(armSel);
    const exWant = s.explode ? 1 : 0;
    if (Math.abs(exWant - explodeT.current) > 1e-3) { explodeT.current += (exWant - explodeT.current) * (reduced ? 1 : 1 - Math.exp(-dt * 7)); busy = true; } else explodeT.current = exWant;
    layerMeshes.current.forEach((m, i) => {
      if (!m) return;
      m.visible = explodeT.current > 0.01 && i < stack.length && !s.hiddenLayers.includes(i);
      if (!m.visible) return;
      m.position.y = 0.7 + i * (0.09 + explodeT.current * 0.72);
      const L = stack[i];
      m.material = s.layer === i ? M.neutral.pick : L.kind === 'setup' ? M.neutral[`cond_${armSel}`] : L.kind === 'output' ? M.neutral.tips : M.neutral.plate2;
    });

    // The selected bug: tile colour, lamps and analysis bars from its real outcomes.
    const t = tasks[s.task];
    if (lastTask.current !== s.task || (s.runs && lampMats[0].userData.runs !== s.runs)) {
      lastTask.current = s.task;
      const m = tiles.current;
      if (m) {
        tasks.forEach((tt, i) => m.setColorAt(i, color.set(i === s.task ? C.pick : tt.set === 'test' ? C.test : C.fresh)));
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
      arms.forEach((a, r2) => {
        for (let q = 0; q < repeats; q++) {
          const solved = s.runs ? s.runs[r2]?.[q] : q < t.solved[a.id];
          lampMats[r2 * 2 + q].color.set(solved ? C.solved : C.failed);
        }
        const score = t.solved[a.id] / repeats;
        barMats[r2].color.set(score === 1 ? C.solved : score === 0 ? C.failed : C.half);
        const b = bars.current[r2];
        if (b) { const len = Math.max(0.05, score * 2.3); b.scale.set(len, 0.14, 0.5); b.position.x = X.analysis - 1.15 + len / 2; }
      });
      const bl = baseline.current;
      if (bl) bl.position.x = X.analysis - 1.15 + (t.solved.none / repeats) * 2.3;
      lampMats[0].userData.runs = s.runs;
    }

    // Focus highlight: the selected lane or run is outlined in blue.
    const f: Focus = s.focus;
    if (lastFocus.current !== f) {
      lastFocus.current = f;
      const laneSel = f.kind === 'lane' || f.kind === 'run' ? arms.findIndex((a) => a.id === f.arm) : -1;
      laneMeshes.current.forEach((m, i) => { if (m) (m.material as MeshStandardMaterial) = i === laneSel ? M.agent.laneOn : M.agent.plate; });
      wsEdges.current.forEach((e, i) => {
        if (!e) return;
        const on = f.kind === 'run' ? i === laneSel * 2 + f.rep : f.kind === 'workspace' || f.kind === 'agent' || i === laneSel * 2 || i === laneSel * 2 + 1;
        (e as unknown as { material: LineBasicMaterial }).material = on ? edgeMat.pick : edgeMat.agent;
      });
    }

    // DOM labels follow their anchors (positions relative to the stage element). They only move when
    // the model does.
    if (refit) {
      o.updateMatrixWorld();
      // Each label is lifted clear of those already placed, so neighbours never cover each other on a
      // narrow stage. Transforms do not dirty layout, so these reads stay cheap.
      const placed: DOMRect[] = [];
      const place = (key: string, at: [number, number, number]) => {
        const el = wbLabels[key];
        if (!el) return;
        tmpV.set(at[0], at[1], at[2]).applyMatrix4(g.matrixWorld).project(camera);
        const cx = (tmpV.x * 0.5 + 0.5) * window.innerWidth - r.left;
        let cy = (-tmpV.y * 0.5 + 0.5) * window.innerHeight - r.top;
        const write = () => { el.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`; };
        write();
        for (let k = 0; k < 6; k++) {
          const b = el.getBoundingClientRect();
          if (!b.width) return;
          const hit = placed.find((p) => b.left < p.right + 2 && b.right > p.left - 2 && b.top < p.bottom + 2 && b.bottom > p.top - 2);
          if (!hit) { placed.push(b); return; }
          cy -= b.bottom - hit.top + 3;
          write();
        }
      };
      for (let i = 0; i < LANES; i++) place(`lane${i}`, laneLabelAt(i));
      MODULE_LABELS.forEach((l) => place(l.key, l.at));
    }

    if (busy) scenes.animate('workbench'); else scenes.settle('workbench');
  });

  // The shared canvas listens on the whole page, and three.js raycasts hidden objects too. So a
  // pointer event counts only while the model is shown and it lands on the bare 3D stage, never on a
  // button, the inspector or the 2D diagram drawn over the same spot.
  const onStage = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    if (!outer.current?.visible) return false;
    const el = e.nativeEvent.target as Element | null;
    return !!el && !!el.closest('.wb__stage') && !el.closest('button, a, select');
  };
  const pick = (focus: Focus) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6 || !onStage(e)) return;
    e.stopPropagation();
    wb.set({ focus });
    requestFrame('state');
  };
  const hover = (on: boolean) => (e: ThreeEvent<PointerEvent>) => {
    document.body.style.cursor = on && onStage(e) ? 'pointer' : '';
  };
  const hit = (focus: Focus) => ({ onClick: pick(focus), onPointerOver: hover(true), onPointerOut: hover(false) });

  const tokens = (arm: ArmId, x: number, z: number, scale: number, zone: Mats) => {
    const c = CONDITIONS[arm];
    const docMat = arm === 'handwritten' ? zone.generic : zone.tips;
    return (
      <group position={[x, 0, z]} scale={scale}>
        {c.hasTips && <Box p={[c.hasHooks ? -0.17 : 0, 0.08, 0]} s={[0.26, 0.035, 0.34]} m={docMat} />}
        {c.hasHooks && <mesh geometry={G.ring} material={zone.hook} position={[c.hasTips ? 0.19 : 0, 0.09, 0]} rotation={[Math.PI / 2, 0, 0]} />}
      </group>
    );
  };

  return (
    <group ref={outer}>
      <group ref={inner}>
        <ambientLight intensity={0.85} />
        <directionalLight position={[-4, 9, 6]} intensity={1.4} />
        <directionalLight position={[6, 4, -6]} intensity={0.6} color={SPECTRAL.amber} />
        <directionalLight position={[-8, 2, -4]} intensity={0.5} color={SPECTRAL.blue} />

        {/* Board, outlined */}
        <Box p={[-0.6, -0.06, 0.8]} s={[19.9, 0.06, 9.7]} m={M.neutral.board} />
        <lineSegments geometry={G.edges} material={edgeMat.agent} position={[-0.6, -0.06, 0.8]} scale={[19.9, 0.06, 9.7]} />

        {/* A: task source. Main tray (test | fresh) and, apart, the dev tray. */}
        <Box p={[X.tray, 0.02, -0.15]} s={[2.5, 0.08, 4.35]} m={M.agent.plate2} {...hit({ kind: 'source', group: 'main' })} />
        <instancedMesh ref={tiles} args={[G.box, tileMat, tasks.length]} {...hit({ kind: 'source', group: 'main' })} />
        <Box p={[X.dev, 0.02, Z.devTray]} s={[2.35, 0.06, 1.45]} m={M.agent.plate} {...hit({ kind: 'source', group: 'dev' })} />
        <instancedMesh ref={devTiles} args={[G.box, devMat, 40]} {...hit({ kind: 'source', group: 'dev' })} />
        <lineSegments geometry={devLine.g} material={devLine.m} onUpdate={(l) => l.computeLineDistances()} />

        {/* Router: the selected bug goes to every lane (the pairing). */}
        <Box p={[X.manifold, 0.07, 0]} s={[0.16, 0.1, LANES + 0.1]} m={M.agent.rail} />
        <Box p={[(X.tray + 1.25 + X.manifold) / 2, 0.07, -0.15]} s={[X.manifold - X.tray - 1.25, 0.06, 0.12]} m={M.agent.pick} />

        {/* B: six condition lanes, each with its setup module and two repeat channels. */}
        {arms.map((a, r) => (
          <group key={a.id}>
            <mesh ref={(m) => { laneMeshes.current[r] = m; }} geometry={G.box} material={M.agent.plate}
              position={[(X.laneStart + X.laneEnd) / 2, 0.02, laneZ(r)]} scale={[X.laneEnd - X.laneStart, 0.05, 0.84]} {...hit({ kind: 'lane', arm: a.id })} />
            <Box p={[X.laneStart + 0.16, 0.13, laneZ(r)]} s={[0.2, 0.06, 0.2]} m={M.agent[`cond_${a.id}`]} />
            <Box p={[X.setup, 0.07, laneZ(r)]} s={[0.78, 0.06, 0.7]} m={M.agent.plate2} />
            {tokens(a.id, X.setup, laneZ(r), 1, M.agent)}
            {Array.from({ length: repeats }, (_, q) => (
              <Box key={q} p={[(X.setup + 0.5 + X.laneEnd) / 2, 0.065, repZ(r, q)]} s={[X.laneEnd - X.setup - 0.5, 0.03, 0.07]} m={M.agent.rail} />
            ))}
          </group>
        ))}

        {/* C: twelve isolated workspaces for the selected bug: snapshot, issue card, assigned setup. */}
        {arms.map((a, r) => Array.from({ length: repeats }, (_, q) => {
          const z = repZ(r, q);
          return (
            <group key={`${a.id}${q}`} position={[X.ws, 0, z]}>
              <mesh geometry={G.box} material={M.agent.glass} position={[0, 0.27, 0]} scale={[2.0, 0.5, 0.34]} {...hit({ kind: 'run', arm: a.id, rep: q })} />
              <lineSegments ref={(e) => { wsEdges.current[r * 2 + q] = e; }} geometry={G.edges} material={edgeMat.agent} position={[0, 0.27, 0]} scale={[2.0, 0.5, 0.34]} />
              <Box p={[-0.05, 0.07, 0]} s={[1.6, 0.06, 0.24]} m={M.agent.snapshot} />
              <Box p={[-0.78, 0.2, 0]} s={[0.03, 0.18, 0.2]} m={M.agent.issue} />
              {tokens(a.id, 0.55, 0, 0.62, M.agent)}
              <Box p={[1.45, 0.06, 0]} s={[0.3, 0.035, 0.2]} m={M.agent.patch} />
            </group>
          );
        }))}

        {/* Muse Code: one independent execution per workspace. */}
        <Box p={[X.ws, 0.1, -3.62]} s={[3.2, 0.18, 0.34]} m={M.agent.plate2} {...hit({ kind: 'agent' })} />

        {/* The exploded workspace: one plate per real layer of a run's workspace, for the chosen condition. */}
        {Array.from({ length: MAX_LAYERS }, (_, i) => (
          <mesh key={i} ref={(m) => { layerMeshes.current[i] = m; }} geometry={G.box} material={M.neutral.plate2} position={[X.ws, 0.7, 0]} scale={[3.3, 0.06, 2.6]} visible={false} />
        ))}

        {/* D: the information barrier. Only patches pass (one slot per run); nothing comes back. */}
        <mesh geometry={G.box} position={[X.wall, 0.65, 0]} scale={[0.05, 1.3, LANES + 0.3]} material={M.neutral.glass} {...hit({ kind: 'agent' })} />
        <lineSegments geometry={G.edges} material={edgeMat.wall} position={[X.wall, 0.65, 0]} scale={[0.05, 1.3, LANES + 0.3]} />
        {arms.map((a, r) => Array.from({ length: repeats }, (_, q) => (
          <Box key={`slot${a.id}${q}`} p={[X.wall, 0.08, repZ(r, q)]} s={[0.08, 0.1, 0.24]} m={M.neutral.patch} />
        )))}

        {/* E: evaluator with the hidden tests; one lamp per run from its real outcome. */}
        <Box p={[X.bench, 0.08, 0]} s={[2.1, 0.16, LANES + 0.2]} m={M.eval.plate2} {...hit({ kind: 'evaluator' })} />
        <Box p={[X.bench, 0.3, Z.tests]} s={[1.2, 0.4, 0.9]} m={M.eval.tests} {...hit({ kind: 'evaluator' })} />
        <Box p={[X.bench - 0.45, 0.18, (Z.tests - 0.45 + laneZ(0) - 0.4) / 2]} s={[0.06, 0.04, Z.tests - 0.45 - laneZ(0) + 0.4]} m={M.eval.tests} />
        {arms.map((a, r) => Array.from({ length: repeats }, (_, q) => (
          <group key={`ev${a.id}${q}`}>
            <Box p={[X.bench - 0.75, 0.19, repZ(r, q)]} s={[0.3, 0.035, 0.2]} m={M.eval.patch} />
            <mesh geometry={G.box} material={lampMats[r * 2 + q]} position={[X.bench + 0.6, 0.27, repZ(r, q)]} scale={[0.22, 0.2, 0.22]} {...hit({ kind: 'run', arm: a.id, rep: q })} />
          </group>
        )))}

        {/* F: paired analysis for this bug: each condition's score (share of 2 runs) against No setup's. */}
        <Box p={[X.analysis, 0.04, 0]} s={[3.0, 0.08, LANES + 0.2]} m={M.eval.plate} {...hit({ kind: 'analysis' })} />
        {arms.map((a, r) => (
          <group key={`an${a.id}`}>
            <Box p={[X.analysis, 0.1, laneZ(r)]} s={[2.5, 0.03, 0.5]} m={M.eval.rail} />
            <mesh ref={(m) => { bars.current[r] = m; }} geometry={G.box} material={barMats[r]} position={[X.analysis, 0.17, laneZ(r)]} scale={[1, 0.14, 0.5]} {...hit({ kind: 'analysis' })} />
          </group>
        ))}
        <mesh ref={baseline} geometry={G.box} material={M.eval.issue} position={[X.analysis, 0.28, 0]} scale={[0.035, 0.12, LANES]} />
      </group>
    </group>
  );
}
