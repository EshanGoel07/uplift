# Uplift results website

A static, interactive presentation of the finished Uplift study: 924 Muse Code runs on 77 real
sqlglot bugs, six agent setups, and the finding that **no setup was shown to differ from no setup**.
The content rules are in [`BRIEF.md`](BRIEF.md); build history is in [`BUILD_LOG.md`](BUILD_LOG.md);
measured quality is in [`QUALITY_REPORT.md`](QUALITY_REPORT.md).

The site calls no models and no APIs. It fetches only its own static JSON.

## Quick start

```bash
cd site
npm ci                      # Node 20+ (built with Node 22.13)
npm run data                # split data/results.json into public/data/ (Python 3, standard library)
npm run dev                 # http://localhost:5173
```

## Data pipeline

`data/results.json` is the source of truth. It is written by `uplift export` in the repo root, and
the site never edits it.

```bash
npm run data    # = python scripts/split_results.py
```

This writes, deterministically (rerunning produces identical bytes):

| File | Contents | Size |
| --- | --- | --- |
| `public/data/summary.json` | summary, arms, trust cards, per-task metadata (set, title, solved per arm, group, hooks fired) | ~24 KB |
| `public/data/tasks/<id>.json` | one task exactly as in the source: issue, 6 arms × 2 runs, diffs, hook messages | 77 files |
| `public/data/results.json` | byte-for-byte copy, served as the "raw data" download | 2.5 MB |

The script checks that the source hash is unchanged and refuses inconsistent data (wrong arm set,
not two runs, `solved` not matching resolved runs).

Figures that are **not** in `results.json` (detectable effect, web-leak tiers, robustness table,
failure facts, project spend) live in `src/data/reportFigures.ts`. Each one is copied verbatim from
`reports/main.md` or `SUBMISSION.md`, with a comment naming its source. Unit tests cross-check the
overlapping values against `results.json`.

## Build, test, preview

```bash
npm run typecheck   # tsc --noEmit
npm test            # Vitest: data integrity, formatting, diff parser, markdown sanitiser (25 tests)
npm run build       # typecheck + vite build -> dist/
npm run preview     # serves dist/ under /uplift/ on http://localhost:4173/uplift/
npm run e2e         # Playwright against the preview server (15 tests)
```

Before the first e2e run: `npx playwright install chromium`. On Windows the tests use hardware GL
(ANGLE/D3D11); elsewhere they use SwiftShader.

QA helpers (not part of the build):

```bash
node scripts/qa/shot.mjs http://localhost:4173/uplift/ out.png 1440 900 "pin:.hero__pin:0.9" 2000
node scripts/qa/fps.mjs           # steady-state fps per section
node scripts/capture-poster.mjs   # regenerate public/assets/signal-field-fallback.jpg from the live render
```

Debug switches: `?nowebgl` forces the static fallback, and `?off=bloom,fill,lines,dust,strands,streams,core`
turns off individual 3D parts for profiling.

## Deploy (Vercel)

Live at https://uplift-sandy-mu.vercel.app (Vercel project `mastak7s-projects/uplift`, linked
from this folder; `.vercel/` is git-ignored).

`vercel.json` sets the Vite preset, `npm ci`, `npm run build` and `dist/`, plus long-lived caching
for the hashed JS, CSS and fonts. Vercel doesn't run `npm run data` (that needs Python), so regenerate
`public/data/` locally before deploying. `.vercelignore` keeps `node_modules`, `dist` and QA output
out of the upload.

```bash
npm run data
vercel deploy          # preview URL
vercel deploy --prod   # production
E2E_URL=https://uplift-sandy-mu.vercel.app/ npm run e2e   # browser tests against the live site
```

Against a root-hosted deployment, the two tests that assert the `/uplift/` sub-path fail by design.

## Deploy (GitHub Pages)

The build uses relative URLs (`base: './'`), so `dist/` works from any sub-path.

1. `npm run data && npm run build`
2. Publish `site/dist/` to the `gh-pages` branch (for example `npx gh-pages -d dist`), or add a Pages
   workflow that runs the two commands above and uploads `site/dist`.

`dist/` is git-ignored. `public/data/` is generated, but small enough to commit if you want Pages to
build without Python.

## Architecture

```
src/
  app/App.tsx              page shell; lazy-loads the 3D chunk on idle; WebGL error boundary
  state/sceneStore.ts      shared state: scroll progress in mutable refs (read in useFrame),
                           UI state (paused, interact, stage) via useSyncExternalStore
  data/                    types, loader (+ per-task cache), formatters, classification, report figures
  sections/                Hero, Results, BugMatrix, BugExplorer, Trust, Methodology, BuiltVsUsed,
                           Limitations, FutureWork, Footer
  components/              nav, scene controls, interval chart, diff viewer, run panel, hotspots
  scenes/                  ONE shared <Canvas>: SignalField, ExperimentStreams, MatrixSurface,
                           PipelineEngine, custom GLSL (simplex noise, spectral ramp)
  utils/                   unified-diff parser, sanitised markdown, linear scale
```

- **One WebGL context.** A fixed canvas sits behind the page. Each scene reads its visibility from
  scroll progress and lays itself out over a DOM "stage" rectangle, so 3D and HTML stay aligned.
  When no scene is on screen the canvas renders nothing.
- **Scroll storytelling** uses GSAP ScrollTrigger inside `gsap.context` (reverted on unmount):
  - Pinned sequence A: the field splits into six streams, desktop only.
  - Pinned sequence B: the 3D matrix sheet unfolds into the grid.
  - Pinned sequence C: the pipeline builds stage by stage, desktop only.
- **Start-up.** Shaders are compiled with `compileAsync` (KHR_parallel_shader_compile) before the
  first frame. The matrix and pipeline scenes mount only as their sections approach.
- **Untrusted content.** Diffs render as React text nodes. Issue markdown goes through marked and
  then DOMPurify: no images, scripts, iframes or inline handlers, and links are http(s) only with
  `rel="noopener noreferrer"`. The build adds a strict Content-Security-Policy.
- **Accessibility.** The 3D layer is decorative (`aria-hidden`), and every fact it shows also exists
  in the DOM:
  - The matrix is a real ARIA grid with arrow-key navigation.
  - Reduced motion: no pins, and the scene starts paused (Resume is a real opt-in).
  - Without WebGL: a still poster captured from the real render.

## Credits

Built by Aryan Kansal and Eshan Goel for the Meta Global AI Developer Hackathon. Data: sqlglot (MIT,
© Toby Mao) and SWE-rebench (CC-BY-4.0). See `../NOTICE.md`. Fonts: Geist and Geist Mono (SIL OFL),
bundled locally.
