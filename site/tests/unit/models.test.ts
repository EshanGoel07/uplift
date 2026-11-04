// The story models must say what the code says. They are data, so the claims can be checked directly.
import { describe, expect, it } from 'vitest';
import { cutawayModel, workspaceModel } from '../../src/data/models';
import { CONDITIONS, workspaceLayers } from '../../src/data/method';
import type { ArmId } from '../../src/data/types';

const ARMS: ArmId[] = ['none', 'prose', 'sensors', 'both', 'handwritten', 'tuned'];

describe('workspace model', () => {
  it.each(ARMS)('%s has one part per real layer, with a pose for every state', (arm) => {
    const m = workspaceModel(arm);
    expect(m.parts.map((p) => p.id)).toEqual(workspaceLayers(arm).map((l) => l.id));
    for (const p of m.parts) expect(p.poses).toHaveLength(m.views.length);
  });
  it.each(ARMS)('%s shows guidance and hooks only if it installed them', (arm) => {
    const ids = workspaceModel(arm).parts.map((p) => p.id);
    expect(ids.includes('agents')).toBe(CONDITIONS[arm].hasTips);
    expect(ids.includes('hooks')).toBe(CONDITIONS[arm].hasHooks);
  });
});

describe('cutaway model', () => {
  const m = cutawayModel();
  const part = (id: string) => m.parts.find((p) => p.id === id)!;
  const hidden = m.parts.filter((p) => p.id.startsWith('hidden'));

  it('never puts a hidden test on the agent side of the barrier', () => {
    expect(hidden).toHaveLength(2);
    for (const p of hidden) for (const q of p.poses) expect(q.p[0]).toBeGreaterThan(0);
  });
  it('has the agent gone before the tests reach the workspace', () => {
    const applied = hidden[0].poses.findIndex((q, i) => i > 0 && q.p[0] !== hidden[0].poses[0].p[0]);
    expect(applied).toBeGreaterThan(0);
    expect(part('muse').poses[applied].on).toBe(0);
    expect(part('muse').poses[applied - 1].on).toBe(1);
  });
  it('moves the workspace across, not only the patch', () => {
    const last = m.views.length - 1;
    for (const id of ['snapshot', 'setup', 'patch']) {
      expect(part(id).poses[last].on).toBe(1);
      expect(part(id).poses[last].p[0]).toBeGreaterThan(0);
    }
  });
});
