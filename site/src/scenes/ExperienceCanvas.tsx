import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { Summary } from '../data/types';
import { invalidations, requestFrame, scenes, setInvalidator, ui, useScenes, useUi } from '../state/sceneStore';
import { lattice, latticeProbe } from '../state/latticeStore';
import { workbenchBounds } from '../state/workbenchStore';
import { useNear } from '../hooks/useNear';
import { OFF } from './layout';
import { NebulaScene } from './Nebula/NebulaScene';
import { RunLatticeScene } from './RunLattice/RunLattice';
import { StageView } from './StageView';

const CohortScene = lazy(() => import('./Cohort/CohortScene'));

// Workbench-only code (the scene and postprocessing) lives behind this one dynamic import. It renders
// into this canvas: no second renderer, just a later chunk. Do not import it statically.
// A failed download is an expected condition, not a crash: the section stays on its 2D diagram.
const WorkbenchLayer = lazy(() => import('./Workbench/WorkbenchLayer').catch(() => {
  ui.set({ workbench3dFailed: true });
  return { default: (() => null) as unknown as typeof import('./Workbench/WorkbenchLayer').default };
}));

/** If the Workbench chunk or scene fails, the section shows its 2D diagram; the lattice carries on. */
class WorkbenchBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { ui.set({ workbench3dFailed: true }); }
  render() { return this.state.failed ? null : this.props.children; }
}

/**
 * The one WebGL canvas of the site. Everything 3D renders here, through one renderer:
 *
 *   frame:  scene callbacks (priority 0)
 *        -> main pass, the default scene at full size (priority 1): a plain render, or the bloom
 *           composer, which arrives with the lazy Workbench layer
 *        -> stage views, scenes with their own camera, scissored to a DOM stage (priority 2)
 *
 * The frameloop is always 'demand'. A frame happens because something changed: the
 * registry (a visible stage moved, or visibility flipped), a store (selection), or a scene that is
 * animating and asks for its next frame. At rest nothing runs.
 *
 * To add a scene: extend SceneId, request it from its section with a stage element, and mount it here
 * (in the default scene, like the workbench, or in a StageView, like the lattice).
 */
export const frameCount = { n: 0 };
if (typeof window !== 'undefined') (window as unknown as { __upliftFrames: typeof frameCount }).__upliftFrames = frameCount;

const COHORT_CAMERA = { fov: 34, near: 0.1, far: 200, position: [0, 0, 14] as [number, number, number] };
const LATTICE_CAMERA = { fov: 34, near: 0.1, far: 120, position: [0, 4, 10] as [number, number, number] };
const NEBULA_CAMERA = { fov: 34, near: 0.1, far: 60, position: [0, 0, 8.4] as [number, number, number] };

/** Wires on-demand frames and counts them. */
function FrameDriver() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    setInvalidator(() => invalidate());
    return () => setInvalidator(null);
  }, [invalidate]);
  useFrame(() => { frameCount.n++; }, -1);
  return null;
}

/** The main pass when bloom is not drawing: priority callbacks switch off R3F's automatic render. */
function MainPass({ enabled }: { enabled: boolean }) {
  useFrame((s) => { if (enabled) { s.gl.setRenderTarget(null); s.gl.render(s.scene, s.camera); } }, 1);
  return null;
}

/** Development/`?diag` only: read-only engine state on `window.__upliftDiag`. Ordinary visitors never get it. */
const DIAG = typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('diag'));
let contexts = 0;
function Diagnostics() {
  const gl = useThree((s) => s.gl);
  const frameloop = useThree((s) => s.frameloop);
  useEffect(() => {
    const w = window as unknown as { __upliftDiag?: unknown };
    w.__upliftDiag = {
      contexts: () => contexts,
      canvases: () => document.querySelectorAll('canvas').length,
      frames: () => frameCount.n,
      frameloop: () => frameloop,
      invalidations: () => ({ ...invalidations }),
      scenes: () => scenes.list().map((e) => ({ id: e.id, phase: scenes.phase(e.id), mounted: e.mounted, visible: e.visible, animating: e.animating, visibility: e.visibility, mounts: e.mounts, disposals: e.disposals })),
      activeScenes: () => scenes.list().filter((e) => e.visible).length,
      animating: () => scenes.list().some((e) => e.animating),
      workbenchBounds: () => ({ ...workbenchBounds }),
      latticeHovered: () => lattice.get().hovered,
      latticeColumn: (bug: number) => latticeProbe.column?.(bug) ?? null,
      renderer: () => ({ calls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length ?? 0 }),
    };
    return () => { delete w.__upliftDiag; };
  }, [gl, frameloop]);
  return null;
}

export default function ExperienceCanvas({ summary }: { summary: Summary | null }) {
  const [ready, setReady] = useState(false);
  // Scenes mount as their sections approach, so start-up work is split into small pieces. Phones and
  // no-WebGL browsers never request the workbench, so it never loads into the renderer there.
  const wantLattice = useScenes(() => scenes.get('lattice').requested);
  const wantCohort = useScenes(() => scenes.get('cohort').requested);
  const wantNebula = useScenes(() => scenes.get('nebula').requested);
  const wantWorkbench = useScenes(() => scenes.get('workbench').requested);
  const nearWorkbench = useNear('#method', '120% 0px');
  const workbenchShown = useScenes(() => scenes.get('workbench').visible);
  const workbenchMounted = useScenes(() => scenes.get('workbench').mounted);
  const workbenchFailed = useUi((s) => s.workbench3dFailed);
  const active = useUi((s) => s.activeScene);
  const lowTier = useUi((s) => s.lowTier);
  const mountWorkbench = !!summary && nearWorkbench && wantWorkbench && !workbenchFailed;
  // Phones and low-core devices skip the bloom pass.
  const bloom = !lowTier && !OFF.has('bloom');
  // The plain main pass keeps drawing until the composer's chunk has actually arrived.
  const composing = bloom && workbenchMounted && workbenchShown;
  // Which pass draws the main scene changed: it needs a frame (React state does not wake the renderer).
  useEffect(() => { requestFrame('visibility'); }, [composing]);

  return (
    <div className={`experience${ready ? ' is-ready' : ''}`} aria-hidden="true" style={{ visibility: active ? 'visible' : 'hidden' }}>
      <Canvas
        eventSource={document.getElementById('root')!}
        eventPrefix="client"
        frameloop="demand"
        dpr={lowTier ? [1, 1.5] : [1, 2]}
        camera={{ fov: 35, position: [0, 0, 10], near: 0.1, far: 60 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', stencil: false }}
        onCreated={({ gl }) => { contexts++; gl.setClearColor(0x000000, 0); setReady(true); }}
      >
        <FrameDriver />
        {DIAG && <Diagnostics />}
        <MainPass enabled={!composing} />
        {mountWorkbench && (
          <WorkbenchBoundary>
            <Suspense fallback={null}>
              <WorkbenchLayer summary={summary} bloom={bloom} composing={composing} />
            </Suspense>
          </WorkbenchBoundary>
        )}
        {wantNebula && <StageView id="nebula" camera={NEBULA_CAMERA}><NebulaScene /></StageView>}
        {wantLattice && <StageView id="lattice" camera={LATTICE_CAMERA}><RunLatticeScene /></StageView>}
        {wantCohort && <Suspense fallback={null}><StageView id="cohort" camera={COHORT_CAMERA}><CohortScene /></StageView></Suspense>}
      </Canvas>
    </div>
  );
}
