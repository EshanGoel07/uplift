import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { HalfFloatType, PerspectiveCamera, WebGLRenderTarget } from 'three';
import type { Summary } from '../data/types';
import { live, requestFrame, setInvalidator, ui, useUi, type SceneName } from '../state/sceneStore';
import { OFF, clientToWorld, pointerWorld } from './layout';
import { WorkbenchScene } from './Workbench/WorkbenchScene';

export const frameCount = { n: 0 };
if (typeof window !== 'undefined') (window as unknown as { __upliftFrames: typeof frameCount }).__upliftFrames = frameCount;

/** Which scene is on screen, from the scroll-driven visibility values. */
function computeActive(): SceneName | null {
  return live.workbenchVis >= 0.05 ? 'workbench' : null;
}

/** Advances simulation time, tracks the pointer and the active scene, and wires on-demand frames. */
function Driver() {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setInvalidator(() => invalidate());
    const onMove = (e: PointerEvent) => {
      lastPointer.current = { x: e.clientX, y: e.clientY };
      live.pointer.active = e.pointerType === 'mouse' || ui.get().interact;
      invalidate();
    };
    const onLeave = () => { live.pointer.active = false; };
    const onScroll = () => {
      requestAnimationFrame(() => ui.set({ activeScene: computeActive() }));
      invalidate();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
    return () => {
      setInvalidator(null);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [invalidate]);

  useFrame((_, dt) => {
    frameCount.n++;
    const s = ui.get();
    if (!s.paused) live.time += Math.min(dt, 0.05);  // reduced motion starts paused; Resume opts in
    if (lastPointer.current) clientToWorld(lastPointer.current.x, lastPointer.current.y, camera, pointerWorld);
  }, -1);
  return null;
}

/**
 * Compiles every shader with KHR_parallel_shader_compile before the first frame, so linking the
 * programs never blocks the main thread. The canvas stays on frameloop 'never' until this resolves.
 */
function Precompile({ onDone, offscreen }: { onDone: () => void; offscreen: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let live = true;
    const done = () => { if (live) onDone(); };
    const r = gl as unknown as { compileAsync?: (s: unknown, c: unknown) => Promise<unknown> };
    if (!r.compileAsync) { done(); return () => { live = false; }; }
    // The bloom composer renders the scene into an offscreen half-float target, which changes the
    // program keys (linear output). Compile with such a target bound so the first frame reuses them.
    const rt = offscreen ? new WebGLRenderTarget(1, 1, { type: HalfFloatType }) : null;
    const prev = gl.getRenderTarget();
    if (rt) gl.setRenderTarget(rt);
    const p = r.compileAsync(scene, camera);
    if (rt) gl.setRenderTarget(prev);
    p.then(done, done).finally(() => rt?.dispose());
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Selective bloom (only values above ~0.92 glow), faded in after the first frames. */
function FadeInBloom({ target, levels }: { target: number; levels: number }) {
  const bloom = useRef<{ intensity: number } | null>(null);
  const start = useRef<number | null>(null);
  useFrame((state) => {
    const b = bloom.current;
    if (!b) return;
    start.current ??= state.clock.elapsedTime;
    const k = Math.min(1, (state.clock.elapsedTime - start.current) / 0.8);
    b.intensity = target * k * k * (3 - 2 * k);
    if (k < 1) requestFrame();
  });
  return (
    <EffectComposer multisampling={0}>
      <Bloom ref={bloom as never} mipmapBlur levels={levels} luminanceThreshold={0.92} luminanceSmoothing={0.12} intensity={0} radius={0.72} />
    </EffectComposer>
  );
}

/** True once the element is within `margin` of the viewport (and stays true). */
function useNear(selector: string, margin: string): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) return;
    let io: IntersectionObserver | null = null;
    const attach = () => {
      const el = document.querySelector(selector);
      if (!el) { window.setTimeout(attach, 400); return; }
      io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setNear(true); io?.disconnect(); } }, { rootMargin: margin });
      io.observe(el);
    };
    attach();
    return () => io?.disconnect();
  }, [selector, margin, near]);
  return near;
}

export default function ExperienceCanvas({ summary }: { summary: Summary | null }) {
  const [compiled, setCompiled] = useState(false);
  // Scenes mount as their sections approach, so start-up work is split into small pieces.
  const needWorkbench = useNear('#method', '120% 0px');
  const paused = useUi((s) => s.paused);
  const reduced = useUi((s) => s.reducedMotion);
  const active = useUi((s) => s.activeScene);
  const lowTier = useUi((s) => s.lowTier);
  const running = !paused && active !== null;
  // Phones and low-core devices skip the bloom pass; the core's halo sprite still glows.
  const bloom = !lowTier && !OFF.has('bloom');

  // A still, composed frame for reduced motion.
  useEffect(() => { if (reduced) live.time = 14; }, [reduced]);

  return (
    <div className={`experience${compiled ? ' is-ready' : ''}`} aria-hidden="true" style={{ visibility: active ? 'visible' : 'hidden' }}>
        <Canvas
          eventSource={document.getElementById('root')!}
          eventPrefix="client"
          frameloop={!compiled ? 'never' : running ? 'always' : 'demand'}
          dpr={lowTier ? [1, 1.5] : [1, 2]}
          camera={{ fov: 35, position: [0, 0, 10], near: 0.1, far: 60 }}
          gl={{ antialias: false, alpha: true, powerPreference: 'high-performance', stencil: false }}
          onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); }}
        >
          <Driver />
          <Precompile offscreen={bloom} onDone={() => { setCompiled(true); window.setTimeout(requestFrame, 30); }} />
          {needWorkbench && summary && <WorkbenchScene summary={summary} />}
          {bloom && <FadeInBloom target={0.95} levels={6} />}
        </Canvas>
    </div>
  );
}
