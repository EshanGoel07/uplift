// DOM hotspot buttons live in the page (so they are real, focusable buttons above the content);
// the Signal Field writes their screen positions each frame through these refs.
export const hotspotRefs: { layer: HTMLElement | null; items: (HTMLElement | null)[] } = { layer: null, items: [] };

/** Anchor points in the field's rotating frame (unit shell radius is about 2). */
export const HOTSPOT_POSITIONS: [number, number, number][] = [
  [-1.75, 1.55, 1.2],
  [2.0, 1.25, 0.9],
  [-1.95, -1.4, 1.0],
  [1.75, -1.6, 1.2],
];
