import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

export interface WorldRect { x: number; y: number; w: number; h: number }

/** Half-extent of the visible area on the z = 0 plane. */
export function viewAtZ0(camera: PerspectiveCamera): { halfW: number; halfH: number } {
  const halfH = Math.tan(MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  return { halfW: halfH * camera.aspect, halfH };
}

/** Maps a DOM rect (client pixels) to a rect on the z = 0 plane in world units. */
export function rectToWorld(rect: DOMRect | { left: number; top: number; width: number; height: number }, camera: PerspectiveCamera): WorldRect {
  const { halfW, halfH } = viewAtZ0(camera);
  const W = window.innerWidth, H = window.innerHeight;
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  return {
    x: ((cx / W) * 2 - 1) * halfW,
    y: (-(cy / H) * 2 + 1) * halfH,
    w: (rect.width / W) * 2 * halfW,
    h: (rect.height / H) * 2 * halfH,
  };
}

/** Client-pixel point to world point on z = 0. */
export function clientToWorld(px: number, py: number, camera: PerspectiveCamera, out = new Vector3()): Vector3 {
  const { halfW, halfH } = viewAtZ0(camera);
  return out.set(((px / window.innerWidth) * 2 - 1) * halfW, (-(py / window.innerHeight) * 2 + 1) * halfH, 0);
}

const tmp = new Vector3();
/** World point to client pixels. */
export function worldToClient(p: Vector3, camera: PerspectiveCamera): { x: number; y: number; behind: boolean } {
  tmp.copy(p).project(camera);
  return { x: (tmp.x * 0.5 + 0.5) * window.innerWidth, y: (-tmp.y * 0.5 + 0.5) * window.innerHeight, behind: tmp.z > 1 };
}

export const smooth = (a: number, b: number, x: number): number => {
  const t = MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent damping toward a target. */
export const damp = (cur: number, target: number, lambda: number, dt: number): number =>
  MathUtils.damp(cur, target, lambda, dt);

/** Pointer position on the z = 0 plane, updated by the Driver each frame. */
export const pointerWorld = new Vector3(999, 999, 0);
export const pointerState = { strength: 0 };

/** Debug switch for profiling: ?off=fill,lines,core,strands,dust,streams,bloom */
export const OFF: Set<string> = new Set(typeof window !== 'undefined' ? (new URLSearchParams(window.location.search).get('off') ?? '').split(',').filter(Boolean) : []);
