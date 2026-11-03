import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, BoxGeometry, Color, Group, InstancedMesh, MathUtils, MeshBasicMaterial, Object3D, PerspectiveCamera } from 'three';
import type { Summary } from '../../data/types';
import { GROUP_ORDER, groupOf, sortForMatrix } from '../../data/classify';
import { live } from '../../state/sceneStore';
import { damp, rectToWorld, smooth, viewAtZ0 } from '../layout';
import { SPECTRAL } from '../palette';

const ROWS = 6;

/**
 * Pinned sequence B. The real 77 x 6 outcome grid (same order and bands as the HTML matrix below)
 * starts as a curved, rippling spectral sheet and unfolds flat, column by column, before the 3D layer
 * fades and the accessible HTML grid takes over. Here bugs run left to right and setups top to bottom.
 */
export function MatrixSurface({ summary }: { summary: Summary }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const group = useRef<Group>(null);
  const mesh = useRef<InstancedMesh>(null);
  const userRot = useRef({ x: 0, y: 0 });
  const zoom = useRef(1);
  const bandsRect = useRef<DOMRect | null>(null);

  const cells = useMemo(() => {
    const tasks = sortForMatrix(summary.tasks);
    const counts = GROUP_ORDER.map((g) => tasks.filter((t) => groupOf(t.solved) === g).length);
    const out: { col: number; row: number; v: number; band: number; inBand: number }[] = [];
    tasks.forEach((t, col) => {
      const band = GROUP_ORDER.indexOf(groupOf(t.solved));
      const inBand = col - counts.slice(0, band).reduce((a, b) => a + b, 0);
      summary.arms.forEach((a, row) => out.push({ col, row, v: t.solved[a.id], band, inBand }));
    });
    return { list: out, counts, n: tasks.length };
  }, [summary]);

  const { geo, mat } = useMemo(() => ({
    geo: new BoxGeometry(1, 1, 0.02),
    mat: new MeshBasicMaterial({ transparent: true, opacity: 1, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
  }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);

  // Spectral value colours: 2/2 warm core, 1/2 magenta-violet, 0/2 deep blue.
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c2 = new Color(SPECTRAL.cyan).lerp(new Color(SPECTRAL.blue), 0.55).multiplyScalar(0.42);
    const c1 = new Color(SPECTRAL.amber).multiplyScalar(1.15);
    const c0 = new Color(SPECTRAL.violet).lerp(new Color(SPECTRAL.magenta), 0.25).multiplyScalar(0.32);
    cells.list.forEach((c, i) => m.setColorAt(i, c.v === 2 ? c2 : c.v === 1 ? c1 : c0));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [cells]);

  useEffect(() => {
    const read = () => { bandsRect.current = document.querySelector('.matrix-intro__bands-inner')?.getBoundingClientRect() ?? null; };
    read();
    window.addEventListener('resize', read);
    window.addEventListener('scroll', read, { passive: true });
    return () => { window.removeEventListener('resize', read); window.removeEventListener('scroll', read); };
  }, []);

  const dummy = useMemo(() => new Object3D(), []);

  useFrame((_, rawDt) => {
    const g = group.current, m = mesh.current;
    if (!g || !m) return;
    const dt = Math.min(rawDt, 0.05);
    const p = live.matrix;
    const vis = p >= 0.999 ? 0 : live.matrixVis * (1 - smooth(0.84, 0.99, p));
    g.visible = vis > 0.01;
    if (!g.visible) return;
    mat.opacity = vis;

    const { halfW, halfH } = viewAtZ0(camera);
    const unfold = smooth(0.08, 0.72, p);
    const t = live.time;

    // Flat layout matches the HTML band labels: widths proportional to band sizes, 2% gaps.
    const br = bandsRect.current;
    const wr = br ? rectToWorld(br, camera) : { x: 0, y: -halfH * 0.5, w: halfW * 1.7, h: 0 };
    const width = wr.w;
    const gap = width * 0.02;
    const cellW = (width - gap * 2) / cells.n;
    const cellH = Math.min(cellW * 2.6, halfH * 0.11);
    const top = wr.y + cellH * (ROWS + 0.6);
    const bandStart = (band: number) => wr.x - width / 2 + cells.counts.slice(0, band).reduce((a, b) => a + b, 0) * cellW + band * gap;

    const R = Math.max(2.6, width * 0.42);
    cells.list.forEach((c, i) => {
      // Curved state: wrapped on a cylinder with a travelling ripple.
      const u = c.col / (cells.n - 1) - 0.5;
      const ang = u * Math.PI * 1.25;
      const ripple = Math.sin(c.col * 0.22 + t * 0.9) * 0.18 + Math.sin(c.row * 0.9 + t * 0.6) * 0.06;
      const cx = Math.sin(ang) * R;
      const cz = (Math.cos(ang) - 1) * R * 0.85 - 1.2 + ripple;
      const cy = (2.5 - c.row) * 0.34 + Math.cos(c.col * 0.17 + t * 0.7) * 0.12;
      // Flat state.
      const fx = bandStart(c.band) + (c.inBand + 0.5) * cellW;
      const fy = top - (c.row + 0.5) * cellH;
      // Columns unfold left to right.
      const k = MathUtils.clamp(unfold * 1.45 - (c.col / cells.n) * 0.45, 0, 1);
      const e = k * k * (3 - 2 * k);
      dummy.position.set(MathUtils.lerp(cx, fx, e), MathUtils.lerp(cy, fy, e), MathUtils.lerp(cz, 0, e));
      dummy.rotation.set(0, MathUtils.lerp(-ang, 0, e), 0);
      const sw = MathUtils.lerp(0.085, cellW * 0.8, e), sh = MathUtils.lerp(0.24, cellH * 0.78, e);
      dummy.scale.set(sw, sh, 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;

    userRot.current.x = damp(userRot.current.x, live.rot.matrix.x, 5, dt);
    userRot.current.y = damp(userRot.current.y, live.rot.matrix.y, 5, dt);
    zoom.current = damp(zoom.current, live.zoom.matrix, 6, dt);
    g.rotation.set(MathUtils.lerp(-0.42, 0, unfold) + userRot.current.x, MathUtils.lerp(0.5, 0, unfold) + userRot.current.y, MathUtils.lerp(0.06, 0, unfold));
    g.position.set(0, MathUtils.lerp(halfH * 0.05, 0, unfold), 0);
    g.scale.setScalar(zoom.current);
  });

  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[geo, mat, cells.list.length]} frustumCulled={false} renderOrder={7} />
    </group>
  );
}
