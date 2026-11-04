import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { HalfFloatType, WebGLRenderTarget } from 'three';
import type { Summary } from '../../data/types';
import { requestFrame } from '../../state/sceneStore';
import { WorkbenchScene } from './WorkbenchScene';

/**
 * Everything only the 3D Workbench needs: the scene and the bloom post-process. This module is the
 * one lazy boundary, loaded by the shared canvas when the Workbench is requested and near, so phones
 * and tablets (which show the 2D diagram) never download it. It renders into the existing canvas.
 */

/** Selective bloom (only values above ~0.92 glow), faded in over the first visible frames. */
function FadeInBloom({ target, levels, enabled }: { target: number; levels: number; enabled: boolean }) {
  const bloom = useRef<{ intensity: number } | null>(null);
  const start = useRef<number | null>(null);
  useFrame((state) => {
    const b = bloom.current;
    if (!b || !enabled) return;
    start.current ??= state.clock.elapsedTime;
    const k = Math.min(1, (state.clock.elapsedTime - start.current) / 0.8);
    b.intensity = target * k * k * (3 - 2 * k);
    if (k < 1) requestFrame('animation');
  });
  return (
    <EffectComposer multisampling={0} enabled={enabled} renderPriority={1}>
      <Bloom ref={bloom as never} mipmapBlur levels={levels} luminanceThreshold={0.92} luminanceSmoothing={0.12} intensity={0} radius={0.72} />
    </EffectComposer>
  );
}

/**
 * Links the Workbench's programs ahead of its first frame, so that frame does not block the main
 * thread. The composer draws into a half-float target, which changes the program keys (linear
 * output), so with bloom the compile runs with such a target bound.
 */
function Precompile({ offscreen }: { offscreen: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let on = true;
    const again = () => { if (on) requestFrame('mount'); };
    const r = gl as unknown as { compileAsync?: (s: unknown, c: unknown) => Promise<unknown> };
    if (!r.compileAsync) return;
    const rt = offscreen ? new WebGLRenderTarget(1, 1, { type: HalfFloatType }) : null;
    const prev = gl.getRenderTarget();
    if (rt) gl.setRenderTarget(rt);
    const p = r.compileAsync(scene, camera);
    if (rt) gl.setRenderTarget(prev);
    p.then(again, again).finally(() => rt?.dispose());
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default function WorkbenchLayer({ summary, bloom, composing }: { summary: Summary; bloom: boolean; composing: boolean }) {
  return (
    <>
      <WorkbenchScene summary={summary} />
      <Precompile offscreen={bloom} />
      {bloom && <FadeInBloom target={0.95} levels={6} enabled={composing} />}
    </>
  );
}
