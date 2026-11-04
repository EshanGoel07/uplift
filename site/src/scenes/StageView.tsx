import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal, useFrame, useThree, type RootState } from '@react-three/fiber';
import { PerspectiveCamera, Scene } from 'three';
import { requestFrame, scenes, useScenes, type SceneId } from '../state/sceneStore';

/** Runs after the main pass (priority 1): views draw on top of it without clearing colour. */
export const VIEW_PRIORITY = 2;

interface CameraSpec { fov: number; near: number; far: number; position: [number, number, number] }

/**
 * Draws a scene with its own camera into the rectangle of its DOM stage, using the one shared
 * renderer: a portal (so inside it `useThree` reports the stage's size and this camera) plus a
 * scissored render pass. It is the same pattern as drei's View, without taking over the main pass.
 *
 * The stage rect is read inside the frame, so the picture stays locked to the DOM while scrolling.
 * Nothing is drawn while the scene is off screen, and pointer events outside the stage hit nothing.
 *
 * Ownership: the scene and camera belong to this view. Geometries and materials belong to the scene
 * component that created them, and it disposes them. The portal's reconciler adds and removes the scene's
 * children. This view must never empty the scene itself: in React's StrictMode an effect cleanup also runs
 * on a live mount, and clearing there left a mounted scene with nothing to draw.
 */
export function StageView({ id, camera: spec, children }: { id: SceneId; camera: CameraSpec; children: ReactNode }) {
  const gl = useThree((s) => s.gl);
  const stage = useScenes(() => scenes.get(id).stage);
  const [scene] = useState(() => new Scene());
  const camera = useMemo(() => {
    const c = new PerspectiveCamera(spec.fov, 1, spec.near, spec.far);
    c.position.set(...spec.position);
    return c;
  }, [spec]);
  const [size, setSize] = useState(() => {
    const r = stage?.getBoundingClientRect();
    return { width: r?.width || 1, height: r?.height || 1, top: 0, left: 0 };
  });

  // Only a size change reaches the scene; moving with the page does not.
  useEffect(() => {
    if (!stage) return;
    const read = () => {
      const r = stage.getBoundingClientRect();
      setSize((s) => (s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height, top: 0, left: 0 }));
      // The stage's layout can arrive with no scroll or resize at all: skipped content rendering in.
      scenes.remeasure();
    };
    read();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    ro?.observe(stage);
    return () => ro?.disconnect();
  }, [stage]);

  useLayoutEffect(() => {
    camera.aspect = size.width / Math.max(1, size.height);
    camera.updateProjectionMatrix();
    requestFrame('resize');
  }, [camera, size]);

  useEffect(() => {
    scenes.setMounted(id, true);
    // Link the programs ahead of the first frame so the first draw does not block the main thread.
    const r = gl as unknown as { compileAsync?: (s: Scene, c: PerspectiveCamera) => Promise<unknown> };
    let on = true;
    const go = () => { if (on) requestFrame('mount'); };
    if (r.compileAsync) r.compileAsync(scene, camera).then(go, go); else go();
    return () => { on = false; scenes.setMounted(id, false); };
  }, [id, gl, scene, camera]);

  useFrame((state) => {
    const e = scenes.get(id);
    if (!e.visible || !e.stage) return;
    const r = e.stage.getBoundingClientRect();
    const g = state.gl, H = state.size.height, bottom = H - r.bottom;
    const auto = g.autoClear;
    g.autoClear = false;
    g.setRenderTarget(null);
    g.setViewport(r.left, bottom, r.width, r.height);
    g.setScissor(r.left, bottom, r.width, r.height);
    g.setScissorTest(true);
    g.clearDepth();
    g.render(scene, camera);
    scenes.drawn(id, scene.children.length);
    g.setScissorTest(false);
    g.setViewport(0, 0, state.size.width, H);
    g.autoClear = auto;
  }, VIEW_PRIORITY);

  const events = useMemo(() => ({
    priority: VIEW_PRIORITY,
    // Pointer events reach the page's root element: count only those landing on the bare stage.
    compute(event: { clientX: number; clientY: number; target?: EventTarget | null }, state: RootState) {
      const el = scenes.get(id).stage;
      const target = event.target as Node | null;
      if (el && scenes.isVisible(id) && target && el.contains(target)) {
        const r = el.getBoundingClientRect();
        state.pointer.set(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1);
        state.raycaster.setFromCamera(state.pointer, state.camera);
      } else {
        // Aim the ray away from everything: the bounding-sphere test rejects it before any instance.
        state.raycaster.ray.origin.set(1e6, 1e6, 1e6);
        state.raycaster.ray.direction.set(0, 1, 0);
      }
    },
  }), [id]);

  return <>{createPortal(children, scene, { camera, size, events })}</>;
}
