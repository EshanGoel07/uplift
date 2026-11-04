import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { BoxGeometry, type BufferGeometry, CylinderGeometry, EdgesGeometry, ExtrudeGeometry, type Group, type LineSegments, type Mesh, PlaneGeometry, Shape, type PerspectiveCamera, Vector3 } from 'three';
import { assemblies, setAssembly, useAssembly, type AssemblyId, type Link, type Part } from '../../state/assemblyStore';
import { scenes, type SceneId } from '../../state/sceneStore';
import { ceramicMaterial, edgeMaterial, filamentLineMaterial, hazeMaterial } from '../materials/shared';

/**
 * Draws one story model: dark ceramic parts with fine lit edges, in the Nebula's atmosphere. Everything
 * about the model is data, so the same scene serves the workspace, the cutaway and the grader.
 *
 * Poses and the camera are targets, never timelines: a later step or a reversed scroll simply changes
 * where everything is heading, so nothing can land late on top of a newer state.
 */
const TEXT_COLUMN = (w: number) => (w >= 1100 ? 450 : 370);

function slabGeometry(w: number, h: number, d: number): BufferGeometry {
  const r = Math.min(0.16, Math.min(w, d) / 5);
  const s = new Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const bevel = Math.min(0.02, h / 4);
  const g = new ExtrudeGeometry(s, { depth: Math.max(0.01, h - bevel * 2), bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -h / 2 + bevel, 0);
  return g;
}

function geometryFor(part: Part): BufferGeometry {
  const [w, h, d] = part.size;
  if (part.shape === 'column') return new CylinderGeometry(w / 2, w / 2, h, 40, 1);
  if (part.shape === 'wall') return new BoxGeometry(w, h, d);
  return slabGeometry(w, h, d);
}

interface Live { pos: Vector3; on: number; glow: number; pick: number }

function PartMesh({ part, id, live }: { part: Part; id: AssemblyId; live: Map<string, { live: Live; group: Group | null; mat: ReturnType<typeof ceramicMaterial>; edge: ReturnType<typeof edgeMaterial> }> }) {
  const group = useRef<Group>(null);
  const body = useMemo(() => geometryFor(part), [part]);
  const edges = useMemo(() => new EdgesGeometry(body, 32), [body]);
  const mat = useMemo(() => ceramicMaterial(part.accent), [part.accent]);
  const edge = useMemo(() => edgeMaterial(part.accent), [part.accent]);

  useEffect(() => {
    const prior = live.get(part.id);
    const first = assemblies[id].state;
    const pose = part.poses[first];
    live.set(part.id, { live: prior?.live ?? { pos: new Vector3(...pose.p), on: 0, glow: 0, pick: 0 }, group: group.current, mat, edge });
    return () => { live.delete(part.id); };
  }, [id, part, mat, edge, live]);
  useEffect(() => () => { body.dispose(); edges.dispose(); mat.dispose(); edge.dispose(); }, [body, edges, mat, edge]);

  const pick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if ((live.get(part.id)?.live.on ?? 0) < 0.5) return;
    setAssembly(id, { selected: assemblies[id].selected === part.id ? null : part.id });
  };
  return (
    <group ref={group} visible={false}>
      <mesh geometry={body} material={mat} renderOrder={2} onClick={pick}
            onPointerOver={(e) => { e.stopPropagation(); setAssembly(id, { hovered: part.id }); }}
            onPointerOut={() => { if (assemblies[id].hovered === part.id) setAssembly(id, { hovered: null }); }} />
      <lineSegments geometry={edges} material={edge} renderOrder={3} raycast={() => null} />
    </group>
  );
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
  const live = useMemo(() => new Map<string, { live: Live; group: Group | null; mat: ReturnType<typeof ceramicMaterial>; edge: ReturnType<typeof edgeMaterial> }>(), []);
  const links = useRef<(LineSegments | null)[]>([]);
  const quad = useMemo(() => new PlaneGeometry(1, 1), []);
  const unit = useMemo(() => new CylinderGeometry(0.028, 0.028, 1, 8, 1), []);
  const hazeMat = useMemo(() => hazeMaterial({ seed: 5.2, intensity: 0.62, warmth: 0.45 }), []);
  useEffect(() => () => { quad.dispose(); unit.dispose(); hazeMat.dispose(); }, [quad, unit, hazeMat]);

  const st = useMemo(() => ({ target: new Vector3(), dist: 0, yaw: 0, el: 0, ready: false, fitted: '', v: new Vector3(), a: new Vector3(), b: new Vector3(), up: new Vector3(0, 1, 0), linkOn: new Float32Array(16) }), []);

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

    for (const part of a.model.parts) {
      const e = live.get(part.id);
      if (!e) { busy = true; continue; }
      const pose = part.poses[a.state] ?? part.poses[0];
      const l = e.live;
      const chosen = a.selected === part.id ? 1 : a.hovered === part.id ? 0.5 : 0;
      l.on = ease(l.on, pose.on, 4);
      l.glow = ease(l.glow, pose.glow ?? 0, 4);
      l.pick = ease(l.pick, chosen, 10);
      for (const axis of ['x', 'y', 'z'] as const) {
        const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
        l.pos[axis] = ease(l.pos[axis], pose.p[i], 3.4);
      }
      if (e.group) { e.group.position.copy(l.pos); e.group.visible = l.on > 0.01; }
      // Unrelated parts recede while one is selected; nothing vanishes.
      const dim = a.selected && a.selected !== part.id ? 0.45 : 1;
      e.mat.uniforms.uFade.value = l.on * (part.glass ? 0.22 : 1);
      e.mat.uniforms.uGlow.value = l.glow;
      e.mat.uniforms.uSelect.value = l.pick;
      e.mat.uniforms.uDim.value = dim;
      e.mat.transparent = part.glass || l.on < 0.995;
      e.mat.depthWrite = !part.glass;
      e.edge.uniforms.uFade.value = l.on * dim * (0.55 + 0.45 * l.glow);
      e.edge.uniforms.uSelect.value = l.pick;
    }

    a.model.links.forEach((link, i) => {
      const m = links.current[i], x = live.get(link.from), y = live.get(link.to);
      if (!m || !x || !y) return;
      const want = (link.on[a.state] ?? 0) * Math.min(x.live.on, y.live.on);
      st.linkOn[i] = ease(st.linkOn[i], want, 4);
      m.visible = st.linkOn[i] > 0.01;
      (m.material as ReturnType<typeof filamentLineMaterial>).uniforms.uFade.value = st.linkOn[i];
      st.a.copy(x.live.pos); st.b.copy(y.live.pos);
      st.v.subVectors(st.b, st.a);
      m.position.copy(st.a).addScaledVector(st.v, 0.5);
      m.scale.set(1, st.v.length(), 1);
      m.quaternion.setFromUnitVectors(st.up, st.v.normalize());
    });

    const view = a.model.views[a.state] ?? a.model.views[0];
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

    // One label only, on the selected part, so labels never pile up over the model.
    const node = a.label;
    if (node) {
      const e = a.selected ? live.get(a.selected) : null;
      if (e) {
        st.v.copy(e.live.pos).project(camera);
        node.style.transform = `translate(${((st.v.x + 1) / 2) * size.width}px, ${((1 - st.v.y) / 2) * size.height}px)`;
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
      {model.parts.map((p) => <PartMesh key={p.id} part={p} id={id} live={live} />)}
      {model.links.map((l, i) => <LinkLine key={`${l.from}-${l.to}`} link={l} geometry={unit} onRef={(m) => { links.current[i] = m; }} />)}
    </>
  );
}

