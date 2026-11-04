import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { CylinderGeometry, type BufferGeometry, Euler, type Group, type LineSegments, type Mesh, PlaneGeometry, type PerspectiveCamera, type ShaderMaterial, Vector3 } from 'three';
import { assemblies, setAssembly, useAssembly, type AssemblyId, type Light, type Link, type Part, type View } from '../../state/assemblyStore';
import { scenes, type SceneId } from '../../state/sceneStore';
import { edgeMaterial, filamentLineMaterial, graphiteMaterial, haloMaterial, hazeMaterial, keyLight, type KeyLight } from '../materials/shared';
import { SPECTRAL } from '../colors';
import { buildForm } from './forms';

/**
 * Draws one story model in the Nebula's atmosphere. Everything about the model is data, so the same scene
 * serves the workspace, the cutaway and the grader; what each object looks like comes from forms.ts.
 *
 * Poses, light and the camera are targets, never timelines: a later step or a reversed scroll simply changes
 * where everything is heading, so nothing can land late on top of a newer state.
 */
const TEXT_COLUMN = (w: number) => (w >= 1100 ? 450 : 370);
const DEFAULT_LIGHT: Light = { p: [0, 1, 0], warm: 1, cool: 0.3 };

interface Live { pos: Vector3; rot: Vector3; on: number; glow: number; pick: number; reveal: number; scale: number; dim: number }
interface Entry { part: Part; live: Live; group: Group | null; turn: Group | null; halo: Mesh | null; mat: ShaderMaterial; edge: ShaderMaterial; haloMat: ShaderMaterial | null }

function PartMesh({ part, id, entries, keyL }: { part: Part; id: AssemblyId; entries: Map<string, Entry>; keyL: KeyLight }) {
  const group = useRef<Group>(null);
  const turn = useRef<Group>(null);
  const halo = useRef<Mesh>(null);
  const live = useRef<Live | null>(null);
  if (!live.current) {
    const pose = part.poses[assemblies[id].state] ?? part.poses[0];
    live.current = { pos: new Vector3(...pose.p), rot: new Vector3(...(pose.rot ?? [0, 0, 0])), on: 0, glow: 0, pick: 0, reveal: pose.reveal ?? 0, scale: pose.scale ?? 1, dim: 1 };
  }
  const key = part.form.key;
  const built = useMemo(() => buildForm(part), [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const mat = useMemo(() => graphiteMaterial(part.accent, keyL), [part.accent, keyL]);
  const edge = useMemo(() => edgeMaterial(part.accent), [part.accent]);
  const haloMat = useMemo(() => (part.halo ? haloMaterial(SPECTRAL.amber) : null), [part.halo]);
  const quad = useMemo(() => (part.halo ? new PlaneGeometry(1, 1) : null), [part.halo]);

  useEffect(() => {
    entries.set(part.id, { part, live: live.current!, group: group.current, turn: turn.current, halo: halo.current, mat, edge, haloMat });
    return () => { entries.delete(part.id); };
  }, [part, entries, mat, edge, haloMat]);
  useEffect(() => () => { built.body.dispose(); built.edges?.dispose(); }, [built]);
  useEffect(() => () => { mat.dispose(); edge.dispose(); haloMat?.dispose(); quad?.dispose(); }, [mat, edge, haloMat, quad]);

  const pick = (e: ThreeEvent<MouseEvent>) => {
    if (part.inert) return;
    e.stopPropagation();
    if ((entries.get(part.id)?.live.on ?? 0) < 0.5) return;
    setAssembly(id, { selected: assemblies[id].selected === part.id ? null : part.id });
  };
  return (
    <group ref={group} visible={false}>
      <group ref={turn}>
        <mesh geometry={built.body} material={mat} renderOrder={2} onClick={pick}
              onPointerOver={(e) => { if (part.inert) return; e.stopPropagation(); setAssembly(id, { hovered: part.id }); }}
              onPointerOut={() => { if (assemblies[id].hovered === part.id) setAssembly(id, { hovered: null }); }} />
        {built.edges && <lineSegments geometry={built.edges} material={edge} renderOrder={3} raycast={() => null} />}
      </group>
      {part.halo && quad && haloMat && <mesh ref={halo} geometry={quad} material={haloMat} scale={part.halo} renderOrder={4} raycast={() => null} />}
    </group>
  );
}

/** Where the camera goes for a selected part: close on it, keeping the story's angle unless the part says otherwise. */
function focusOf(part: Part, state: number, base: View): View {
  const pose = part.poses[state] ?? part.poses[0];
  const reach = Math.max(part.size[0], part.size[2]) * (pose.scale ?? 1);
  return {
    target: part.focus?.target ?? pose.p,
    dist: part.focus?.dist ?? Math.min(base.dist, Math.max(4.5, 2.6 + reach * 1.8)),
    yaw: part.focus?.yaw ?? base.yaw,
    el: part.focus?.el ?? base.el,
  };
}

function LinkLine({ link, geometry, onRef }: { link: Link; geometry: BufferGeometry; onRef: (m: LineSegments | null) => void }) {
  const mat = useMemo(() => filamentLineMaterial(link.accent), [link.accent]);
  useEffect(() => () => mat.dispose(), [mat]);
  return <mesh ref={onRef as never} geometry={geometry} material={mat} renderOrder={1} raycast={() => null} visible={false} />;
}

export default function AssemblyScene({ id }: { id: AssemblyId }) {
  const sceneId = id as SceneId;
  const model = useAssembly(() => assemblies[id].model);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const haze = useRef<Mesh>(null);
  const entries = useMemo(() => new Map<string, Entry>(), []);
  const keyL = useMemo(() => keyLight(), []);
  const links = useRef<(LineSegments | null)[]>([]);
  const quad = useMemo(() => new PlaneGeometry(1, 1), []);
  const unit = useMemo(() => new CylinderGeometry(0.014, 0.014, 1, 6, 1), []);
  const hazeMat = useMemo(() => hazeMaterial({ seed: 5.2, intensity: 0.62, warmth: 0.45 }), []);
  useEffect(() => () => { quad.dispose(); unit.dispose(); hazeMat.dispose(); }, [quad, unit, hazeMat]);

  const st = useMemo(() => ({ target: new Vector3(), dist: 0, yaw: 0, el: 0, ready: false, fitted: '', v: new Vector3(), a: new Vector3(), b: new Vector3(), up: new Vector3(0, 1, 0), linkOn: new Float32Array(24), euler: new Euler(), lit: false }), []);

  useFrame((_, dtRaw) => {
    const a = assemblies[id];
    if (!scenes.isVisible(sceneId) || !a.model) { scenes.settle(sceneId); return; }
    const dt = Math.min(dtRaw, 0.05);
    const k = (lambda: number) => (a.reduced ? 1 : 1 - Math.exp(-dt * lambda));
    let busy = false;
    const ease = (cur: number, want: number, lambda: number): number => {
      if (Math.abs(want - cur) < 1e-3) return want;
      busy = true;
      return cur + (want - cur) * k(lambda);
    };

    // Light first: the warm source, the cool rim, and the haze behind them.
    const light = a.model.lights?.[a.state] ?? DEFAULT_LIGHT;
    const kp = keyL.uKeyP.value;
    if (!st.lit) { kp.set(...light.p); keyL.uWarm.value = light.warm; keyL.uCool.value = light.cool; st.lit = true; }
    kp.set(ease(kp.x, light.p[0], 2.4), ease(kp.y, light.p[1], 2.4), ease(kp.z, light.p[2], 2.4));
    keyL.uWarm.value = ease(keyL.uWarm.value, light.warm, 2.4);
    keyL.uCool.value = ease(keyL.uCool.value, light.cool, 2.4);
    hazeMat.uniforms.uWarmth.value = 0.12 + 0.4 * Math.min(1, keyL.uWarm.value);

    for (const part of a.model.parts) {
      const e = entries.get(part.id);
      if (!e) { busy = true; continue; }
      const pose = part.poses[a.state] ?? part.poses[0];
      const l = e.live;
      const chosen = a.selected === part.id ? 1 : a.hovered === part.id ? 0.5 : 0;
      l.on = ease(l.on, pose.on, 4);
      l.glow = ease(l.glow, pose.glow ?? 0, 4);
      l.pick = ease(l.pick, chosen, 10);
      l.reveal = ease(l.reveal, pose.reveal ?? 0, 2.2);
      l.scale = ease(l.scale, (pose.scale ?? 1) * (1 + 0.05 * (a.selected === part.id ? 1 : 0)), 5);
      l.dim = ease(l.dim, a.selected ? (a.selected === part.id ? 1 : 0.35) : pose.dim ?? 1, 5);
      l.pos.set(ease(l.pos.x, pose.p[0], 3.4), ease(l.pos.y, pose.p[1], 3.4), ease(l.pos.z, pose.p[2], 3.4));
      const r = pose.rot ?? [0, 0, 0];
      l.rot.set(ease(l.rot.x, r[0], 3.4), ease(l.rot.y, r[1], 3.4), ease(l.rot.z, r[2], 3.4));
      if (e.group) {
        e.group.position.copy(l.pos);
        e.group.scale.setScalar(l.scale * (0.92 + 0.08 * l.on));
        e.group.visible = l.on > 0.01;
      }
      if (e.turn) e.turn.rotation.set(l.rot.x, l.rot.y, l.rot.z);
      const u = e.mat.uniforms;
      u.uFade.value = l.on;
      u.uGlow.value = l.glow;
      u.uSelect.value = l.pick;
      u.uDim.value = l.dim;
      u.uReveal.value = l.reveal;
      u.uInkRest.value = part.inkRest ?? 0.6;
      e.mat.transparent = l.on < 0.995;
      e.edge.uniforms.uFade.value = l.on * l.dim * (0.5 + 0.5 * l.glow);
      e.edge.uniforms.uSelect.value = l.pick;
      if (e.haloMat) e.haloMat.uniforms.uAmount.value = l.on * l.dim * l.glow * 0.55;
      if (e.halo) e.halo.quaternion.copy(camera.quaternion);
    }

    a.model.links.forEach((link, i) => {
      const m = links.current[i], x = entries.get(link.from), y = entries.get(link.to);
      if (!m || !x || !y) return;
      const want = (link.on[a.state] ?? 0) * Math.min(x.live.on, y.live.on) * (a.selected ? 0.3 : 1);
      st.linkOn[i] = ease(st.linkOn[i], want, 4);
      m.visible = st.linkOn[i] > 0.01;
      (m.material as ReturnType<typeof filamentLineMaterial>).uniforms.uFade.value = st.linkOn[i] * 0.34;
      st.a.copy(x.live.pos); st.b.copy(y.live.pos);
      if (link.fromAt) st.a.add(st.v.set(...link.fromAt));
      if (link.toAt) st.b.add(st.v.set(...link.toAt));
      st.v.subVectors(st.b, st.a);
      m.position.copy(st.a).addScaledVector(st.v, 0.5);
      m.scale.set(1, st.v.length(), 1);
      m.quaternion.setFromUnitVectors(st.up, st.v.normalize());
    });

    const base = a.model.views[a.state] ?? a.model.views[0];
    const chosenPart = a.selected ? a.model.parts.find((p) => p.id === a.selected) : null;
    const view = chosenPart ? focusOf(chosenPart, a.state, base) : base;
    if (!st.ready) { st.target.set(...view.target); st.dist = view.dist; st.yaw = view.yaw; st.el = view.el; st.ready = true; st.fitted = ''; }
    const yawT = view.yaw + a.yaw, elT = view.el + a.pitch;
    const before = st.dist + st.yaw + st.el + st.target.x + st.target.y + st.target.z;
    st.target.x = ease(st.target.x, view.target[0], 2.6);
    st.target.y = ease(st.target.y, view.target[1], 2.6);
    st.target.z = ease(st.target.z, view.target[2], 2.6);
    st.dist = ease(st.dist, view.dist, 2.6);
    st.yaw = ease(st.yaw, yawT, 5);
    st.el = ease(st.el, elT, 5);
    const fitted = `${size.width}x${size.height}`;
    const moved = before !== st.dist + st.yaw + st.el + st.target.x + st.target.y + st.target.z;
    if (moved || st.fitted !== fitted) {
      st.fitted = fitted;
      const ratio = (size.width - TEXT_COLUMN(size.width)) / Math.max(1, size.height);
      const dist = st.dist * 1.16 * Math.max(1, 1.5 / Math.max(0.4, ratio));   // narrow stages step back
      camera.position.set(
        st.target.x + Math.sin(st.yaw) * Math.cos(st.el) * dist,
        st.target.y + Math.sin(st.el) * dist,
        st.target.z + Math.cos(st.yaw) * Math.cos(st.el) * dist,
      );
      camera.lookAt(st.target);
      camera.setViewOffset(size.width, size.height, TEXT_COLUMN(size.width) / 2, 0, size.width, size.height);
      camera.updateMatrixWorld();
      const hz = haze.current;
      if (hz) {
        const tall = 2 * Math.tan((camera.fov * Math.PI) / 360) * (dist + 6) * 0.98;
        hz.position.copy(st.target).addScaledVector(camera.getWorldDirection(st.v), 6);
        hz.quaternion.copy(camera.quaternion);
        hz.scale.set(tall * (size.width / Math.max(1, size.height)), tall, 1);
      }
    }

    a.settledAt = busy ? -1 : a.state;
    if (busy) scenes.animate(sceneId); else scenes.settle(sceneId);
  });

  useEffect(() => () => { scenes.settle(sceneId); }, [sceneId]);

  if (!model) return null;
  return (
    <>
      <mesh ref={haze} geometry={quad} material={hazeMat} renderOrder={0} raycast={() => null} />
      {model.parts.map((p) => <PartMesh key={p.id} part={p} id={id} entries={entries} keyL={keyL} />)}
      {model.links.map((l, i) => <LinkLine key={`${l.from}-${l.to}-${i}`} link={l} geometry={unit} onRef={(m) => { links.current[i] = m; }} />)}
    </>
  );
}
