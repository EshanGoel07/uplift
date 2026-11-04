import type { CSSProperties } from 'react';

/**
 * Inline style that hands a condition's spectral identity colour to CSS as `--cond`.
 * The colours themselves are `--cond-<arm>` in styles/tokens.css, in the scenes/palette.ts
 * STREAM_COLORS order. Kept free of three.js so DOM components can use it without the 3D chunk.
 */
export const condStyle = (armId: string): CSSProperties => ({ '--cond': `var(--cond-${armId})` } as CSSProperties);
