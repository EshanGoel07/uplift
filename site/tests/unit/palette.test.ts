// The design system has one source of colour per medium: styles/tokens.css for the interface and
// scenes/palette.ts for the 3D materials. These tests keep the two identical, keep the original
// Obsidian x Nebula x Ember values locked, and keep the retired light/blue systems from returning.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONDITION_COLOR, INTERFACE, OUTCOME, SPECTRAL, STREAM_COLORS } from '../../src/scenes/palette';

const src = resolve(__dirname, '../../src');
const tokensCss = readFileSync(resolve(src, 'styles/tokens.css'), 'utf-8');
const token = (name: string): string => {
  const m = tokensCss.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`token --${name} not found`);
  return m[1].trim().toLowerCase();
};

describe('palette.ts mirrors tokens.css', () => {
  const pairs: [string, string][] = [
    ['obsidian', INTERFACE.obsidian], ['carbon', INTERFACE.carbon], ['graphite', INTERFACE.graphite],
    ['elevated', INTERFACE.elevated], ['border', INTERFACE.border], ['border-soft', INTERFACE.borderSoft],
    ['text', INTERFACE.text], ['text-2', INTERFACE.text2], ['text-3', INTERFACE.text3],
    ['ember', INTERFACE.ember], ['burnt', INTERFACE.burnt], ['apricot', INTERFACE.apricot],
    ['ok', OUTCOME.solved], ['fail', OUTCOME.failed], ['warn', OUTCOME.mixed],
    ['sp-cyan', SPECTRAL.cyan], ['sp-blue', SPECTRAL.blue], ['sp-violet', SPECTRAL.violet],
    ['sp-magenta', SPECTRAL.magenta], ['sp-amber', SPECTRAL.amber], ['sp-core', SPECTRAL.core],
  ];
  it.each(pairs)('--%s', (name, hex) => expect(token(name)).toBe(hex.toLowerCase()));
});

describe('the original identity values are locked', () => {
  it('backgrounds, brand, text and outcomes', () => {
    expect([token('obsidian'), token('carbon'), token('graphite'), token('elevated'), token('border'), token('border-soft')])
      .toEqual(['#090a0c', '#101214', '#171a1d', '#202428', '#303337', '#22262a']);
    expect([token('ember'), token('burnt'), token('apricot')]).toEqual(['#ff7138', '#c9552d', '#ffb17a']);
    expect([token('text'), token('text-2'), token('text-3')]).toEqual(['#f5f1eb', '#a8a29b', '#77716b']);
    expect([token('ok'), token('fail'), token('warn')]).toEqual(['#63c78c', '#f07868', '#e7b45a']);
    expect(tokensCss).toMatch(/color-scheme:\s*dark/);
  });
  it('the six conditions follow STREAM_COLORS in arm order, in CSS and in 3D', () => {
    const arms = ['none', 'prose', 'sensors', 'both', 'handwritten', 'tuned'] as const;
    const sp = ['core', 'cyan', 'blue', 'violet', 'magenta', 'amber'];
    arms.forEach((id, i) => {
      expect(CONDITION_COLOR[id]).toBe(STREAM_COLORS[i]);
      expect(token(`cond-${id}`)).toBe(`var(--sp-${sp[i]})`);
    });
  });
});

describe('no retired colour systems', () => {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : /\.(css|tsx?)$/.test(d.name) ? [join(dir, d.name)] : []));
  const all = files(src).map((f) => ({ f, s: readFileSync(f, 'utf-8') }));
  it('no light-theme or blue publication tokens, dark islands or theme switching', () => {
    const bad = all.filter(({ s }) => /--p-[a-z]|--d-[a-z]|pub--dark|is-dark|prefers-color-scheme/.test(s)).map(({ f }) => f);
    expect(bad).toEqual([]);
  });
  it('no hex literals in scene files except the palette', () => {
    const bad = all.filter(({ f, s }) => /[\\/]scenes[\\/]/.test(f) && !/palette\.ts$/.test(f) && /['"]#[0-9a-fA-F]{3,8}['"]/.test(s)).map(({ f }) => f);
    expect(bad).toEqual([]);
  });
});
