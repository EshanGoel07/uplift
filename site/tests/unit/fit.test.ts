// The Workbench model must fit inside its stage as the perspective camera actually draws it.
import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { BACK, BOUNDS, FIT_H, FIT_W, fitToStage } from '../../src/scenes/Workbench/layout';

// The scene's fixed three-quarter view.
const rot = new Matrix4().makeRotationX(0.86).multiply(new Matrix4().makeRotationY(-0.26));
const pts: number[] = [];
for (const x of [BOUNDS.x0, BOUNDS.x1]) for (const y of [BOUNDS.y0, BOUNDS.y1]) for (const z of [BOUNDS.z0, BOUNDS.z1]) {
  const v = new Vector3(x, y, z).applyMatrix4(rot);
  pts.push(v.x, v.y, v.z);
}
const tanHalfFov = Math.tan((35 * Math.PI) / 360);

describe.each([
  ['1024 wide', 1024, 768, 40, 500, 944, 472],
  ['1440 wide', 1440, 900, 128, 130, 1184, 590],
  ['1920 wide', 1920, 1080, 368, 200, 1184, 590],
  ['partly scrolled off the top', 1440, 900, 128, -240, 1184, 590],
  ['tall stage', 1000, 1000, 100, 100, 800, 700],
])('%s', (_, vw, vh, left, top, width, height) => {
  const fit = fitToStage(pts, { tanHalfFov, aspect: vw / vh, z: 10 }, { left, top, width, height, vw, vh });

  it('keeps the projected box inside the stage', () => {
    expect(fit.left).toBeGreaterThanOrEqual(left);
    expect(fit.right).toBeLessThanOrEqual(left + width);
    expect(fit.top).toBeGreaterThanOrEqual(top);
    expect(fit.bottom).toBeLessThanOrEqual(top + height);
  });
  it('fills the stage to its margin on the limiting side, and is centred', () => {
    const w = (fit.right - fit.left) / width, h = (fit.bottom - fit.top) / height;
    expect(Math.max(w / FIT_W, h / FIT_H)).toBeCloseTo(1, 2);
    expect((fit.left + fit.right) / 2).toBeCloseTo(left + width / 2, 0);
    expect((fit.top + fit.bottom) / 2).toBeCloseTo(top + height / 2, 0);
  });
  it('agrees with an independent projection of the corners', () => {
    const halfY = tanHalfFov, halfX = tanHalfFov * (vw / vh);
    let maxBottom = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const depth = 10 + BACK - pts[i + 2] * fit.scale;
      const ndcY = (pts[i + 1] * fit.scale + fit.y) / (halfY * depth);
      maxBottom = Math.max(maxBottom, (0.5 - ndcY * 0.5) * vh);
      expect(Math.abs((pts[i] * fit.scale + fit.x) / (halfX * depth))).toBeLessThan(2);
    }
    expect(maxBottom).toBeCloseTo(fit.bottom, 3);
  });
});
