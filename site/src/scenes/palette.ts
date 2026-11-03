import { Color } from 'three';

// SPECTRAL 3D palette. These colours belong to the 3D world only; the interface stays Obsidian x Ember.
export const SPECTRAL = {
  cyan: '#00C9EF',
  blue: '#247CEB',
  violet: '#6553C7',
  magenta: '#E54291',
  amber: '#FFB66F',
  core: '#FFE5AC',
} as const;

export const col = (hex: string): Color => new Color(hex);

/** The six experiment streams, one per setup, in data order. */
export const STREAM_COLORS = [SPECTRAL.core, SPECTRAL.cyan, SPECTRAL.blue, SPECTRAL.violet, SPECTRAL.magenta, SPECTRAL.amber];
