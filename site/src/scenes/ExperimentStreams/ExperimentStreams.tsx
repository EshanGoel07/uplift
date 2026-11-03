import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Group, BufferAttribute, BufferGeometry, Color, LineSegments, PerspectiveCamera, ShaderMaterial, Vector3, LineBasicMaterial } from 'three';
import { live, ui } from '../../state/sceneStore';
import { clientToWorld, smooth, viewAtZ0 } from '../layout';
import { STREAM_COLORS } from '../palette';
import { rng } from '../SignalField/geometry';
import { fieldCore, fieldState } from '../SignalField/SignalField';

const N_STREAMS = 6;
const PATH_SEGS = 48;

/**
 * The hero's second act: the Signal Field separates into six experiment streams, one per setup,
 * each flowing to its label. Particle positions are computed on the GPU along cubic Bezier paths.
 */
export function ExperimentStreams() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const dpr = useThree((s) => s.viewport.dpr);
  const lowTier = ui.get().lowTier;
  const lines = useRef<LineSegments>(null);
  const root = useRef<Group>(null);
  const ends = useMemo(() => Array.from({ length: N_STREAMS }, () => new Vector3()), []);
  const anchors = useRef<(HTMLElement | null)[]>([]);

  const { geo, mat, pathGeo, pathMat } = useMemo(() => {
    const per = lowTier ? 110 : 260;
    const n = per * N_STREAMS;
    const rand = rng(41);
    const stream = new Float32Array(n), offset = new Float32Array(n), jitter = new Float32Array(n * 3), size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      stream[i] = Math.floor(i / per);
      offset[i] = rand();
      jitter[i * 3] = (rand() - 0.5) * 2; jitter[i * 3 + 1] = (rand() - 0.5) * 2; jitter[i * 3 + 2] = (rand() - 0.5) * 2;
      size[i] = 0.6 + rand() * 1.5;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aStream', new BufferAttribute(stream, 1));
    geo.setAttribute('aOffset', new BufferAttribute(offset, 1));
    geo.setAttribute('aJitter', new BufferAttribute(jitter, 3));
    geo.setAttribute('aSize', new BufferAttribute(size, 1));
    geo.boundingSphere = null;

    const mat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uShow: { value: 0 }, uPR: { value: Math.min(dpr, 2) }, uSpread: { value: 0.12 },
        uP0: { value: new Vector3() },
        uP1: { value: Array.from({ length: N_STREAMS }, () => new Vector3()) },
        uP2: { value: Array.from({ length: N_STREAMS }, () => new Vector3()) },
        uP3: { value: Array.from({ length: N_STREAMS }, () => new Vector3()) },
        uColors: { value: STREAM_COLORS.map((c) => new Color(c)) },
      },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uShow; uniform float uPR; uniform float uSpread;
        uniform vec3 uP0; uniform vec3 uP1[6]; uniform vec3 uP2[6]; uniform vec3 uP3[6]; uniform vec3 uColors[6];
        attribute float aStream; attribute float aOffset; attribute vec3 aJitter; attribute float aSize;
        varying vec3 vColor; varying float vA;
        void main() {
          int s = int(aStream + 0.5);
          float t = fract(aOffset + uTime * (0.05 + 0.012 * aStream));
          float reveal = smoothstep(0.0, 1.0, uShow * 1.4 - t * 0.4);
          float u = 1.0 - t;
          vec3 p = u*u*u*uP0 + 3.0*u*u*t*uP1[s] + 3.0*u*t*t*uP2[s] + t*t*t*uP3[s];
          float width = uSpread * sin(t * 3.14159) + 0.015;
          p += aJitter * width;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = aSize * uPR * 2.2;
          gl_Position = projectionMatrix * mv;
          vColor = uColors[s];
          vA = reveal * smoothstep(0.0, 0.08, t) * (0.35 + 0.65 * smoothstep(0.85, 1.0, t) + 0.4 * (1.0 - t));
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * vA;
          gl_FragColor = vec4(vColor * a * 1.2, a);
        }`,
      transparent: true, depthWrite: false, blending: AdditiveBlending, premultipliedAlpha: true,
    });

    const pathGeo = new BufferGeometry();
    pathGeo.setAttribute('position', new BufferAttribute(new Float32Array(N_STREAMS * PATH_SEGS * 2 * 3), 3));
    const colors = new Float32Array(N_STREAMS * PATH_SEGS * 2 * 3);
    for (let s = 0; s < N_STREAMS; s++) {
      const c = new Color(STREAM_COLORS[s]);
      for (let k = 0; k < PATH_SEGS * 2; k++) colors.set([c.r * 0.35, c.g * 0.35, c.b * 0.35], (s * PATH_SEGS * 2 + k) * 3);
    }
    pathGeo.setAttribute('color', new BufferAttribute(colors, 3));
    const pathMat = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
    return { geo, mat, pathGeo, pathMat };
  }, [lowTier, dpr]);

  useEffect(() => () => { geo.dispose(); mat.dispose(); pathGeo.dispose(); pathMat.dispose(); }, [geo, mat, pathGeo, pathMat]);

  const bez = (p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number, out: Vector3) => {
    const u = 1 - t;
    return out.set(
      u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z,
    );
  };
  const a = useMemo(() => new Vector3(), []), b = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const show = smooth(0.5, 0.86, live.hero) * (1 - live.heroOut);
    const visible = show > 0.005;
    mat.uniforms.uShow.value = show;
    mat.uniforms.uTime.value = live.time;
    pathMat.opacity = show * 0.9;
    if (root.current) root.current.visible = visible;
    if (!visible) return;

    const { halfW, halfH } = viewAtZ0(camera);
    const u = mat.uniforms;
    u.uP0.value.copy(fieldCore);
    u.uSpread.value = 0.1 + fieldState.scale * 0.08;
    for (let s = 0; s < N_STREAMS; s++) {
      let el = anchors.current[s];
      if (!el || !el.isConnected) { el = document.getElementById(`stream-anchor-${s}`); anchors.current[s] = el; }
      if (el) {
        const r = el.getBoundingClientRect();
        clientToWorld(r.left + r.width / 2, r.top + r.height / 2, camera, ends[s]);
      } else {
        ends[s].set(halfW * 0.8, halfH * (0.6 - s * 0.24), 0);
      }
      const p0 = fieldCore, p3 = ends[s];
      const dx = p3.x - p0.x;
      u.uP1.value[s].set(p0.x + dx * 0.25, p0.y + (s - 2.5) * 0.18, 0.8);
      u.uP2.value[s].set(p0.x + dx * 0.62, p3.y, 0.2);
      u.uP3.value[s].copy(p3);
    }
    // Faint guide paths along the same curves.
    const pos = pathGeo.getAttribute('position') as BufferAttribute;
    for (let s = 0; s < N_STREAMS; s++) {
      for (let k = 0; k < PATH_SEGS; k++) {
        bez(u.uP0.value, u.uP1.value[s], u.uP2.value[s], u.uP3.value[s], k / PATH_SEGS, a);
        bez(u.uP0.value, u.uP1.value[s], u.uP2.value[s], u.uP3.value[s], (k + 1) / PATH_SEGS, b);
        const i = (s * PATH_SEGS + k) * 2;
        pos.setXYZ(i, a.x, a.y, a.z);
        pos.setXYZ(i + 1, b.x, b.y, b.z);
      }
    }
    pos.needsUpdate = true;
  });

  return (
    <group ref={root}>
      <points geometry={geo} material={mat} frustumCulled={false} renderOrder={6} />
      <lineSegments ref={lines} geometry={pathGeo} material={pathMat} frustumCulled={false} renderOrder={6} />
    </group>
  );
}
