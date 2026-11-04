import { Color } from 'three';
import type { ArmId } from '../data/types';

// The authoritative 3D palette: Obsidian x Nebula x Ember. Every value mirrors a token in
// styles/tokens.css; tests/unit/palette.test.ts fails if the two drift apart. Scene files take their
// colours from here, never from hex literals.

/** The Nebula spectrum: cyan -> blue -> violet -> magenta around a warm amber core. */
export const SPECTRAL = {
  cyan: '#00C9EF',
  blue: '#247CEB',
  violet: '#6553C7',
  magenta: '#E54291',
  amber: '#FFB66F',
  core: '#FFE5AC',
} as const;

/** Surfaces, text and brand (tokens.css --obsidian ... --apricot). */
export const INTERFACE = {
  obsidian: '#090A0C',
  carbon: '#101214',
  graphite: '#171A1D',
  elevated: '#202428',
  border: '#303337',
  borderSoft: '#22262A',
  text: '#F5F1EB',
  text2: '#A8A29B',
  text3: '#77716B',
  ember: '#FF7138',
  burnt: '#C9552D',
  apricot: '#FFB17A',
} as const;

/** Experimental outcomes (tokens.css --ok / --fail / --warn). Never ember. */
export const OUTCOME = {
  solved: '#63C78C',
  failed: '#F07868',
  mixed: '#E7B45A',
} as const;

export const col = (hex: string): Color => new Color(hex);

/** The six experiment streams, one per setup, in data order. */
export const STREAM_COLORS = [SPECTRAL.core, SPECTRAL.cyan, SPECTRAL.blue, SPECTRAL.violet, SPECTRAL.magenta, SPECTRAL.amber];

/** Each condition's identity colour, derived from STREAM_COLORS in arm order (tokens.css --cond-*). */
const ARM_ORDER: ArmId[] = ['none', 'prose', 'sensors', 'both', 'handwritten', 'tuned'];
export const CONDITION_COLOR = Object.fromEntries(ARM_ORDER.map((id, i) => [id, STREAM_COLORS[i]])) as Record<ArmId, string>;
