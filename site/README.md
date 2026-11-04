# Uplift results website

A static, interactive presentation of the finished Uplift study: 924 Muse Code runs on 77 real
sqlglot bugs, six agent setups, and the finding that **no setup was shown to differ from no setup**.
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
failure facts, project spend, the network block) live in `src/data/reportFigures.ts`. Each one is
taken verbatim from `reports/main.md`, `README.md` or `PHASE_LOG.md`, with a comment naming its source.
Unit tests cross-check the overlapping values against `results.json`. Arm labels and descriptions
are shown exactly as `results.json` gives them. External links (repository, NOTICE.md, demo video)
live in `src/data/links.ts`.

## Build, test, preview

```bash
npm run typecheck   # tsc --noEmit
npm test            # Vitest unit tests
npm run build       # typecheck + vite build -> dist/
npm run preview     # serves dist/ under /uplift/ on http://localhost:4173/uplift/
npm run e2e         # Playwright against the preview server
```

Before the first e2e run: `npx playwright install chromium`. On Windows the tests use hardware GL
(ANGLE/D3D11); elsewhere they use SwiftShader.

Add `?nowebgl` to a URL to see the site with its 3D layer off.

## Deploy (Vercel)

Live at https://uplift-sandy-mu.vercel.app (Vercel project `mastak7s-projects/uplift`, linked
from this folder; `.vercel/` is git-ignored).

`vercel.json` sets the Vite preset, `npm ci`, `npm run build` and `dist/`, plus long-lived caching
for the hashed JS, CSS and fonts. Vercel doesn't run `npm run data` (that needs Python), so regenerate
`public/data/` locally before deploying. `.vercelignore` keeps build and test output out of the upload.

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
  app/App.tsx              page shell; mounts the one canvas when a section requests a scene; WebGL error boundary
  state/sceneStore.ts      UI state and the scene registry: lifecycle, stage measurement, render wake-ups
  state/latticeStore.ts    selection shared by the hero's DOM controls and the lattice scene
  data/                    types, loader (+ per-task cache), formatters, classification, report figures
  sections/                Hero, Results, BugMatrix, BugExplorer, Trust, Methodology, BuiltVsUsed,
                           Limitations, FutureWork, Footer
  components/              nav, experiment overview (hero figure), interval chart, diff viewer, run panel
  scenes/                  ExperienceCanvas: the ONE fixed <Canvas>. WorkbenchScene (#method) draws in its default
                           scene; RunLattice (hero, all 924 runs) draws through a StageView, a scissored pass with
                           its own camera. palette.ts holds the 3D colours; shaders/ the GLSL noise and spectral ramp
  utils/                   unified-diff parser, sanitised markdown, linear scale
```

- **One WebGL context.** A fixed canvas sits behind the page. A section requests a scene for a DOM
  "stage" element; the registry measures how much of it is on screen, and the scene draws into that
  rectangle, so 3D and HTML stay aligned. Rendering is on demand: a frame happens only because something
  changed, a scene that animates asks for frames while it animates, and at rest the canvas renders
  nothing. `?diag` adds read-only engine state on `window.__upliftDiag`.
- **Scrolling is native.** No section pins the page or takes over the wheel.
- **Start-up.** Shaders are compiled with `compileAsync` (KHR_parallel_shader_compile) before the
  first frame. three.js loads only once a section requests a scene, and the Workbench loads as its
  section approaches.
- **Untrusted content.** Diffs render as React text nodes. Issue markdown goes through marked and
  then DOMPurify: no images, scripts, iframes or inline handlers, and links are http(s) only with
  `rel="noopener noreferrer"`. The build adds a strict Content-Security-Policy.
- **Accessibility.** The 3D layer is decorative (`aria-hidden`), and every fact it shows also exists
  in the DOM:
  - The matrix is a real ARIA grid with arrow-key navigation.
  - Reduced motion: the scenes draw a still frame.
  - Without WebGL, and on phones: the hero and the method use SVG and HTML, so nothing is lost.

## Credits

Built by Aryan Kansal and Eshan Goel for the Meta Global AI Developer Hackathon. Data: sqlglot (MIT,
© Toby Mao) and SWE-rebench (CC-BY-4.0). See `../NOTICE.md`. Fonts: Geist and Geist Mono (SIL OFL),
bundled locally.
