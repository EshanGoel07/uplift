import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, Mesh, PerspectiveCamera, PlaneGeometry, SphereGeometry, Vector3, MathUtils } from 'three';
import { live, ui } from '../../state/sceneStore';
import { OFF, damp, pointerState, pointerWorld, rectToWorld, smooth, viewAtZ0, worldToClient } from '../layout';
import { makeDust, makeShell, makeStrands } from './geometry';
import { coreMaterial, dustMaterial, haloMaterial, membraneMaterial, strandMaterial } from './materials';
import { HOTSPOT_POSITIONS, hotspotRefs } from './hotspotRegistry';

/** Where the field's core is in world space; the experiment streams start here. */
export const fieldCore = new Vector3();
export const fieldState = { scale: 1, split: 0 };

const LAYERS = [
  { radius: 1.95, phase: 0.0, freq: 1.0, bias: -0.18, opacity: 0.5, rot: [0.18, 0.12, 0.0], seed: 3 },
  { radius: 1.64, phase: 3.1, freq: 1.18, bias: 0.3, opacity: 0.38, rot: [-0.2, 0.75, 0.5], seed: 17 },
  { radius: 1.34, phase: 6.3, freq: 1.32, bias: 0.62, opacity: 0.34, rot: [0.42, -0.55, -0.35], seed: 29 },
] as const;

export function SignalField() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const dpr = useThree((s) => s.viewport.dpr);
  const lowTier = ui.get().lowTier;
  const group = useRef<Group>(null);
  const spin = useRef<Group>(null);
  const halo = useRef<Mesh>(null);
  const userRot = useRef({ x: 0, y: 0 });
  const zoom = useRef(1);
  const stageRect = useRef<DOMRect | null>(null);

  const parts = useMemo(() => {
    const segT = lowTier ? 96 : 190, segP = lowTier ? 34 : 66;
    const layers = LAYERS.map((l) => {
      const { fill, wire } = makeShell(segT, segP, 2.3, l.seed);
      return {
        ...l, fill, wire,
        wireMat: membraneMaterial({ radius: l.radius, phase: l.phase, freq: l.freq, bias: l.bias, opacity: l.opacity, lines: true }),
        fillMat: membraneMaterial({ radius: l.radius, phase: l.phase, freq: l.freq, bias: l.bias, opacity: l.opacity, lines: false }),
      };
    });
    return {
      layers,
      core: new SphereGeometry(0.4, 48, 32), coreMat: coreMaterial(),
      halo: new PlaneGeometry(5.2, 5.2), haloMat: haloMaterial(),
      strands: makeStrands(lowTier ? 60 : 120, 22, 7), strandMat: strandMaterial(),
      dust: makeDust(lowTier ? 700 : 1700, lowTier ? 350 : 900, 11), dustMat: dustMaterial(Math.min(dpr, 2)),
    };
  }, [lowTier, dpr]);

  useEffect(() => () => {
    parts.layers.forEach((l) => { l.fill.dispose(); l.wire.dispose(); l.wireMat.dispose(); l.fillMat.dispose(); });
    [parts.core, parts.halo, parts.strands, parts.dust].forEach((g) => g.dispose());
    [parts.coreMat, parts.haloMat, parts.strandMat, parts.dustMat].forEach((m) => m.dispose());
  }, [parts]);

  // Cache the stage rect; refresh on resize and scroll (cheap, and only while the hero is near).
  useEffect(() => {
    const read = () => { stageRect.current = document.querySelector('.hero__stage')?.getBoundingClientRect() ?? null; };
    read();
    window.addEventListener('resize', read);
    window.addEventListener('scroll', read, { passive: true });
    return () => { window.removeEventListener('resize', read); window.removeEventListener('scroll', read); };
  }, []);

  const tmp = useMemo(() => new Vector3(), []);

  useFrame((_, rawDt) => {
    const g = group.current, s = spin.current;
    if (!g || !s) return;
    const dt = Math.min(rawDt, 0.05);
    const vis = 1 - live.heroOut;
    g.visible = vis > 0.01;
    const layer = hotspotRefs.layer;
    if (!g.visible) { if (layer) layer.style.visibility = 'hidden'; return; }

    const p = live.hero;
    const t = live.time;
    const deform = smooth(0, 0.5, p);
    const split = smooth(0.42, 0.88, p);
    fieldState.split = split;
    const { halfW, halfH } = viewAtZ0(camera);
    const mobile = window.innerWidth <= 900;

    // Layout: fill the hero's 3D stage (a column on desktop, a band above the text on small screens).
    let cx = 0, cy = 0, size = Math.min(halfW, halfH) * 2;
    const r = stageRect.current;
    if (r && r.width > 0) {
      const w = rectToWorld(r, camera);
      cx = w.x + (mobile ? 0 : w.w * 0.08); cy = w.y;
      size = mobile ? Math.min(w.w * 0.95, w.h * 1.08) : Math.min(w.w * 1.45, w.h * 1.2, halfH * 1.95);
    }
    cx = MathUtils.lerp(cx, -halfW * 0.42, split * 0.85);
    cy = MathUtils.lerp(cy, 0, split * 0.85);
    zoom.current = damp(zoom.current, live.zoom.hero, 6, dt);
    const scale = (size / 2 / 2.5) * (1 - split * 0.35) * zoom.current;
    g.position.set(cx, cy, 0);
    g.scale.setScalar(scale);
    fieldCore.set(cx, cy, 0);
    fieldState.scale = scale;

    userRot.current.x = damp(userRot.current.x, live.rot.hero.x, 5, dt);
    userRot.current.y = damp(userRot.current.y, live.rot.hero.y, 5, dt);
    s.rotation.set(0.32 + userRot.current.x + deform * 0.25, -0.62 + t * 0.045 + deform * 1.25 + userRot.current.y, 0.08 + deform * 0.18);

    const intensity = (mobile ? 0.9 : 1) * vis;
    pointerState.strength = damp(pointerState.strength, live.pointer.active ? 1 : 0, 3, dt);
    for (const l of parts.layers) {
      for (const m of [l.wireMat, l.fillMat]) {
        const u = m.uniforms;
        u.uTime.value = t;
        u.uAmp.value = 1 + deform * 0.6 - split * 0.3;
        u.uExplode.value = split * 0.55;
        u.uOpacity.value = l.opacity * (1 - split * 0.86);
        u.uIntensity.value = intensity;
        u.uPointer.value.copy(pointerWorld);
        u.uPointerStr.value = pointerState.strength * (1 - split);
      }
    }
    parts.coreMat.uniforms.uTime.value = t;
    parts.coreMat.uniforms.uIntensity.value = vis * (1 + split * 0.25);
    parts.haloMat.uniforms.uOpacity.value = vis;
    const su = parts.strandMat.uniforms;
    su.uTime.value = t; su.uOpacity.value = vis * (1 - split * 0.5); su.uSpread.value = split;
    su.uPointer.value.copy(pointerWorld); su.uPointerStr.value = pointerState.strength;
    const du = parts.dustMat.uniforms;
    du.uTime.value = t; du.uOpacity.value = vis; du.uSpread.value = split;
    if (halo.current) halo.current.lookAt(camera.position);

    // Floating counters: project their anchor points onto the page.
    if (layer) {
      const show = vis * (1 - smooth(0.12, 0.35, p));
      layer.style.opacity = String(show);
      layer.style.visibility = show > 0.03 ? 'visible' : 'hidden';
      if (show > 0.03) {
        HOTSPOT_POSITIONS.forEach((pos, i) => {
          const el = hotspotRefs.items[i];
          if (!el) return;
          tmp.set(pos[0], pos[1], pos[2]);
          s.localToWorld(tmp);
          const c = worldToClient(tmp, camera);
          const x = MathUtils.clamp(c.x, 12, window.innerWidth - 190);
          const y = MathUtils.clamp(c.y, 84, window.innerHeight - 120);
          el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        });
      }
    }
  });

  return (
    <group ref={group}>
      {!OFF.has('dust') && <points geometry={parts.dust} material={parts.dustMat} frustumCulled={false} />}
      {!OFF.has('core') && <mesh ref={halo} geometry={parts.halo} material={parts.haloMat} renderOrder={1} />}
      <group ref={spin}>
        {parts.layers.map((l) => (
          <group key={l.seed} rotation={l.rot as unknown as [number, number, number]}>
            {!OFF.has('fill') && l.seed === LAYERS[0].seed && <mesh geometry={l.fill} material={l.fillMat} renderOrder={2} />}
            {!OFF.has('lines') && <lineSegments geometry={l.wire} material={l.wireMat} renderOrder={3} />}
          </group>
        ))}
        {!OFF.has('strands') && <lineSegments geometry={parts.strands} material={parts.strandMat} renderOrder={4} />}
        <mesh geometry={parts.core} material={parts.coreMat} renderOrder={5} />
      </group>
    </group>
  );
}
