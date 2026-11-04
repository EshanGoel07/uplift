// A squarified treemap of a repository: nested rectangles by directory, area following file size. Pure
// numbers, so the models can reason about where a file sits and the 3D kit can extrude the result.

export type RepoFile = [path: string, bytes: number];
export interface Rect { x: number; z: number; w: number; d: number }
export interface Tile extends Rect { path: string; bytes: number; level: number }
export interface Tray extends Rect { path: string; level: number }
interface Node { name: string; path: string; weight: number; bytes: number; dir: boolean; kids: Node[] }

const MAX_LEVEL = 2;   // Deeper files stay in their second-level directory.
const weightOf = (bytes: number) => Math.pow(Math.max(bytes, 200), 0.55);

function tree(files: RepoFile[]): Node {
  const root: Node = { name: '', path: '', weight: 0, bytes: 0, dir: true, kids: [] };
  for (const [path, bytes] of files) {
    const seg = path.split('/');
    let at = root;
    for (let i = 0; i < Math.min(seg.length - 1, MAX_LEVEL); i++) {
      let next = at.kids.find((k) => k.dir && k.name === seg[i]);
      if (!next) { next = { name: seg[i], path: seg.slice(0, i + 1).join('/'), weight: 0, bytes: 0, dir: true, kids: [] }; at.kids.push(next); }
      at = next;
    }
    at.kids.push({ name: path, path, weight: weightOf(bytes), bytes, dir: false, kids: [] });
  }
  const sum = (n: Node): number => { if (n.dir) n.weight = n.kids.reduce((s, k) => s + sum(k), 0); return n.weight; };
  sum(root);
  return root;
}

/** Bruls, Huizing and van Wijk's squarified layout. */
function squarify(items: Node[], box: Rect): [Node, Rect][] {
  const total = items.reduce((s, n) => s + n.weight, 0) || 1;
  const scale = (box.w * box.d) / total;
  const queue = [...items].sort((a, b) => b.weight - a.weight);
  const out: [Node, Rect][] = [];
  let { x, z, w, d } = box;
  const worst = (row: Node[], side: number): number => {
    const areas = row.map((n) => n.weight * scale), s = areas.reduce((a, b) => a + b, 0);
    return Math.max(...areas.map((a) => Math.max((side * side * a) / (s * s), (s * s) / (side * side * a))));
  };
  while (queue.length) {
    const side = Math.min(w, d);
    const row: Node[] = [queue.shift()!];
    while (queue.length && worst([...row, queue[0]], side) <= worst(row, side)) row.push(queue.shift()!);
    const s = row.reduce((a, n) => a + n.weight * scale, 0);
    const thick = s / side;
    let at = 0;
    for (const n of row) {
      const len = (n.weight * scale) / thick;
      out.push([n, w >= d ? { x, z: z + at, w: thick, d: len } : { x: x + at, z, w: len, d: thick }]);
      at += len;
    }
    if (w >= d) { x += thick; w -= thick; } else { z += thick; d -= thick; }
  }
  return out;
}

const inset = (r: Rect, p: number): Rect => ({ x: r.x + p, z: r.z + p, w: Math.max(0.01, r.w - p * 2), d: Math.max(0.01, r.d - p * 2) });

/** Tiles and directory trays, centred on the origin, `width` by `depth`. */
export function repoLayout(files: RepoFile[], width: number, depth: number): { tiles: Tile[]; trays: Tray[] } {
  const tiles: Tile[] = [], trays: Tray[] = [];
  const walk = (n: Node, box: Rect, level: number) => {
    for (const [kid, r] of squarify(n.kids, box)) {
      if (kid.dir) {
        trays.push({ path: kid.path, level, ...r });
        walk(kid, inset(r, level === 0 ? 0.05 : 0.03), level + 1);
      } else {
        tiles.push({ path: kid.path, bytes: kid.bytes, level, ...inset(r, 0.008) });
      }
    }
  };
  walk(tree(files), { x: -width / 2, z: -depth / 2, w: width, d: depth }, 0);
  return { tiles, trays };
}
