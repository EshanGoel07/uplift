/** One small, consistent line-icon set (16 px grid, 1.5 stroke). Decorative: always paired with text or an aria-label. */
const PATHS: Record<string, string> = {
  search: 'M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  arrow: 'M3 8h10M9 4l4 4-4 4',
  up: 'M8 13V3M3.5 7.5 8 3l4.5 4.5',
  external: 'M6 3H3v10h10v-3M9 3h4v4M13 3 7.5 8.5',
  copy: 'M5.5 5.5h8v8h-8zM2.5 10.5v-8h8',
  compare: 'M5.5 2.5v11M10.5 2.5v11M2.5 5.5l3-3 3 3M7.5 10.5l3 3 3-3',
  plus: 'M8 3v10M3 8h10',
  minus: 'M3 8h10',
  reset: 'M3 8a5 5 0 1 0 1.6-3.7M3 2.5v3h3',
  fit: 'M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3',
  focus: 'M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2',
  rotate: 'M13.5 8a5.5 5.5 0 1 1-1.8-4M13.5 1.5v3h-3',
  play: 'M4.5 3v10l8-5z',
  file: 'M4 1.5h5.5L12.5 4.5v10H4zM9.5 1.5v3h3',
  layers: 'M8 2 1.5 5.5 8 9l6.5-3.5zM1.5 8.5 8 12l6.5-3.5',
  check: 'M3 8.5l3.2 3.2L13 5',
  source: 'M5.5 5 2.5 8l3 3M10.5 5l3 3-3 3',
  info: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 7.5v4M8 4.8v.2',
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
