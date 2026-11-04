import { Color } from 'three';

// The authoritative 3D palette: Obsidian x Nebula x Ember. Every value mirrors a token in
// styles/tokens.css; tests/unit/palette.test.ts fails if the two drift apart. Scene files take their
// colours from here, never from hex literals.

export * from './colors';

export const col = (hex: string): Color => new Color(hex);
