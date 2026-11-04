import { CONDITION_COLOR, INTERFACE, SPECTRAL } from '../scenes/colors';
import type { Model, Part, PartPose, Vec3 } from '../state/assemblyStore';
import { workspaceLayers } from './method';
import type { ArmId } from './types';

// The story models, built from the same facts as the text. Nothing here invents a part: every part is a
// layer, file or step that exists in the code, and a condition only shows what it really installed.

export const WORKSPACE_STATES = ['snapshot', 'issue', 'setup', 'assembled', 'patch'] as const;

const SLAB: Vec3 = [5.2, 0.2, 3.4];
const ACCENT: Record<string, string> = { base: SPECTRAL.blue, issue: SPECTRAL.amber, agent: SPECTRAL.core, output: INTERFACE.ember };

/** The layers of one run's workspace, which rise into a stack as the story introduces them. */
export function workspaceModel(arm: ArmId): Model {
  const layers = workspaceLayers(arm);
  const n = layers.length;
  const tight = 0.27, open = 0.74;
  const stackY = (i: number, pitch: number) => (i - (n - 1) / 2) * pitch;
  const appears = (id: string, kind: string): number => {
    if (['snapshot', 'history', 'cleanup'].includes(id)) return 0;
    if (id === 'issue') return 1;
    if (kind === 'setup') return 2;
    if (id === 'agent') return 3;
    return 4;
  };
  const parts: Part[] = layers.map((l, i) => {
    const first = appears(l.id, l.kind);
    const accent = l.kind === 'setup' ? CONDITION_COLOR[arm] : l.id === 'issue' ? ACCENT.issue : l.id === 'agent' ? ACCENT.agent : l.kind === 'output' ? ACCENT.output : ACCENT.base;
    const poses: PartPose[] = [0, 1, 2, 3, 4].map((s) => {
      const present = s >= first;
      const pitch = s === 3 ? tight : open;
      const y = stackY(i, pitch);
      if (!present) return { p: [0, y + 2.2, 0], on: 0 };
      if (l.id === 'patch') return { p: [2.9, y - 0.2, 0.5], on: 1, glow: 1 };
      return { p: [s === 4 ? -0.8 : 0, y, 0], on: 1, glow: s === first ? 1 : l.id === 'agent' && s === 3 ? 1 : 0 };
    });
    return { id: l.id, title: l.title, detail: l.detail, source: l.source, size: l.id === 'patch' ? [3, 0.2, 2] : SLAB, accent, poses };
  });
  return {
    parts,
    links: [{ from: 'agent', to: 'patch', accent: INTERFACE.ember, on: [0, 0, 0, 0, 1] }],
    views: [
      { target: [0, 0, 0], dist: 13, yaw: -0.62, el: 0.46 },
      { target: [0, 0.2, 0], dist: 13, yaw: -0.5, el: 0.42 },
      { target: [0, 0.4, 0], dist: 13.5, yaw: -0.36, el: 0.36 },
      { target: [0, 0, 0], dist: 12, yaw: -0.7, el: 0.5 },
      { target: [0.6, 0, 0], dist: 15, yaw: -0.3, el: 0.26 },
    ],
  };
}
