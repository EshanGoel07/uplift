// @vitest-environment jsdom
// The Atlas's data rules: URLs round-trip, search only finds real records, the architecture graph is
// what the Python says, and every evidence path exists.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { paramsToState, pairCheck, stateToParams, type AtlasState } from '../../src/state/atlasStore';
import { buildIndex, searchIndex } from '../../src/components/atlas/paletteIndex';
import { EVIDENCE } from '../../src/data/evidence';
import { LINEAGE } from '../../src/data/lineage';
import { nebulaPositions, viewToFront } from '../../src/scenes/Nebula/layout';
import { workspaceLayers } from '../../src/data/method';
import type { Summary } from '../../src/data/types';

const site = resolve(__dirname, '../..');
const repo = resolve(site, '..');
const summary = JSON.parse(readFileSync(resolve(site, 'public/data/summary.json'), 'utf-8')) as Summary;
const arch = JSON.parse(readFileSync(resolve(site, 'public/data/architecture.json'), 'utf-8')) as { modules: { name: string; path: string; imports: string[]; items: { name: string; line: number }[] }[] };

describe('URL state', () => {
  it('round-trips the selection and keeps other parameters', () => {
    const s: AtlasState = { task: 'tobymao__sqlglot-4347', condition: 'tuned', repeat: 1, inspector: { kind: 'run' }, compare: [{ kind: 'run', task: 'tobymao__sqlglot-4347', arm: 'none', repeat: 0 }], view: 'investigate', heroMode: 'runs', palette: false, tour: null };
    const q = stateToParams(s, new URLSearchParams('diag=1'));
    expect(q.get('diag')).toBe('1');
    expect(q.get('task')).toBe('4347');
    expect(paramsToState(q)).toMatchObject({ task: s.task, condition: 'tuned', repeat: 1, view: 'investigate', heroMode: 'runs', compare: s.compare });
  });
  it('ignores values that are not in the study', () => {
    expect(paramsToState(new URLSearchParams('cond=nonsense&rep=9'))).toMatchObject({ condition: null, repeat: null });
  });
});

describe('comparison rule', () => {
  it('refuses runs of different bugs as a matched pair', () => {
    expect(pairCheck([{ kind: 'run', task: 'a', arm: 'none', repeat: 0 }, { kind: 'run', task: 'b', arm: 'none', repeat: 0 }]).ok).toBe(false);
    expect(pairCheck([{ kind: 'run', task: 'a', arm: 'none', repeat: 0 }, { kind: 'run', task: 'a', arm: 'tuned', repeat: 1 }]).ok).toBe(true);
  });
});

describe('search', () => {
  const index = buildIndex(summary, arch.modules.map((m) => m.name));
  it('indexes every bug and condition', () => {
    expect(index.filter((i) => i.action.type === 'task' && i.type === 'Bug')).toHaveLength(77);
    expect(index.filter((i) => i.action.type === 'condition')).toHaveLength(6);
  });
  it('finds a real run, and nothing for a bug that does not exist', () => {
    expect(searchIndex(index, '4347 tuned 2')[0]).toMatchObject({ type: 'Run' });
    expect(searchIndex(index, 'zzz-not-a-bug')).toEqual([]);
  });
});

describe('architecture data', () => {
  it('lists every Python module, and its imports match the source', () => {
    const files = readdirSync(resolve(repo, 'src/uplift')).filter((f) => f.endsWith('.py') && f !== '__init__.py');
    for (const f of files) expect(arch.modules.some((m) => m.name === f.replace('.py', '')), f).toBe(true);
    for (const m of arch.modules) {
      const text = readFileSync(resolve(repo, m.path), 'utf-8');
      for (const i of m.imports) expect(new RegExp(`\\b${i}\\b`).test(text), `${m.name} imports ${i}`).toBe(true);
    }
  });
  it('points each definition at its real line', () => {
    for (const m of arch.modules) {
      const lines = readFileSync(resolve(repo, m.path), 'utf-8').split(/\r?\n/);
      for (const it0 of m.items) expect(lines[it0.line - 1]).toContain(it0.name);
    }
  });
  it('serves a current copy of every source file', () => {
    for (const m of arch.modules) {
      const norm = (p: string) => readFileSync(p, 'utf-8').replace(/\r\n/g, '\n');
      expect(norm(resolve(site, 'public/data/source', m.path.split('/').pop()!))).toBe(norm(resolve(repo, m.path)));
    }
  });
  it('names only real modules in the data lineage', () => {
    const names = new Set(arch.modules.map((m) => m.name));
    for (const s of LINEAGE) for (const m of s.modules) expect(names.has(m), m).toBe(true);
  });
});

describe('evidence', () => {
  it('points only at files that exist, and marks unavailable items with no path', () => {
    for (const e of EVIDENCE) {
      if (e.status === 'unavailable') expect(e.path, e.id).toBeNull();
      else expect(existsSync(resolve(repo, e.path!)), e.id).toBe(true);
    }
    expect(new Set(EVIDENCE.map((e) => e.id)).size).toBe(EVIDENCE.length);
  });
});

describe('Nebula layout', () => {
  it('gives each of the 77 bugs a stable, distinct position', () => {
    const a = nebulaPositions(77), b = nebulaPositions(77);
    expect([...a]).toEqual([...b]);
    expect(new Set(Array.from({ length: 77 }, (_, i) => `${a[i * 3].toFixed(3)},${a[i * 3 + 1].toFixed(3)}`)).size).toBe(77);
  });
  it('position does not follow task order', () => {
    const a = nebulaPositions(77);
    const ys = Array.from({ length: 77 }, (_, i) => a[i * 3 + 1]);
    expect(ys.slice(1).filter((y, i) => y < ys[i]).length).toBeLessThan(60);
  });
  it('viewToFront brings a point to the front', () => {
    const { yaw, pitch } = viewToFront(1, 0.5, 2);
    expect(Math.abs(yaw)).toBeGreaterThan(0);
    expect(Math.abs(pitch)).toBeGreaterThan(0);
  });
});

describe('workspace layers', () => {
  it('shows only the artifacts a condition really had', () => {
    expect(workspaceLayers('none').map((l) => l.id)).not.toContain('agents');
    expect(workspaceLayers('none').map((l) => l.id)).not.toContain('hooks');
    expect(workspaceLayers('prose').map((l) => l.id)).not.toContain('hooks');
    expect(workspaceLayers('sensors').map((l) => l.id)).not.toContain('agents');
    expect(workspaceLayers('both')).toHaveLength(8);
  });
});
