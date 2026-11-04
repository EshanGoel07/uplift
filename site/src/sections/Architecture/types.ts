/** Shape of public/data/architecture.json, written by scripts/build_atlas.py. */
export interface ModuleItem { name: string; kind: 'function' | 'class'; line: number; end: number; doc: string }
export interface ModuleInfo { name: string; path: string; lines: number; doc: string; items: ModuleItem[]; imports: string[]; external: string[] }

export const sourcePath = (repoPath: string): string => `${import.meta.env.BASE_URL}data/source/${repoPath.split('/').pop()}`;
