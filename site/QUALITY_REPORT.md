# Quality report: Uplift results website

Measured on 2026-11-02 on the build machine: Windows 11, Intel Iris Xe (integrated GPU), Node 22.13,
Chromium 1248 (Playwright). Every number below was measured. Nothing is estimated unless it says so.

## Tests

| Suite | Command | Result |
| --- | --- | --- |
| Type check | `npm run typecheck` | pass, 0 errors |
| Unit and data integrity (Vitest) | `npm test` | **25 / 25 pass** |
| Production build | `npm run build` | pass |
| Browser e2e (Playwright, prod build under `/uplift/`) | `npm run e2e` | **15 / 15 pass** |
| Data split determinism | run `split_results.py` twice, hash all outputs | identical |
| Source data untouched | sha256 of `data/results.json` before and after, plus `git diff` | unchanged (`5f69ac40…7e34f7`) |
| Repo Python suite | `python -m pytest -q` (repo root) | **not run**: pytest isn't installed on this machine and there's no venv. No files outside `site/` changed. |

**Data integrity, in `tests/unit/data.test.ts`:**
- 924 runs, 77 tasks, 6 setups, 154 attempts each, 2 runs per task and setup.
- Groups are computed as 43 / 23 / 11, summing to 77.
- Setup totals equal per-task sums, and run costs sum to $21.31.
- Wins/losses vs No setup are computed as 6/4, 7/6, 6/7, 4/7, 3/3, matching `reports/main.md`.
- The robustness table's first row equals `results.json`, and every interval crosses zero.
- The fifth trust title is exactly "We caught and measured web leaks"; summary.json is 23.7 KB.

**What the e2e tests cover:**
- Loading under a sub-path: no console errors, no failed requests, no task files fetched on first
  paint.
- The hero's null-result statement and the four numbers from the data.
- Nav jumps and current-section marking.
- The interval chart: 5 rows, zero label, detectable effect, two-setup compare.
- The matrix: 77 rows in 43/23/11 bands, filters, search, cell → correct task and correct PR link,
  keyboard navigation.
- The explorer: featured task, 12 runs, hooks, diff, failed run, compare mode, no `img`, `script` or
  `iframe` in rendered issues.
- Trust: retitled card and investigation tables.
- Limitations (8), future work (5) and the sqlglot caveat; banned wording is absent.
- The raw-data link resolves (200) under `/uplift/`.
- No horizontal overflow at 375, 390 and 768 px.
- The no-WebGL poster.
- WebGL controls: Pause freezes time, Interact drag changes rotation, Esc exits, Reset zeroes it.
- Hotspot buttons open their card.
- Reduced motion: no pins, starts paused, Resume really animates.

## Build output

| Chunk | Size | gzip | Loaded |
| --- | --- | --- | --- |
| `index.js` (React, GSAP, page) | 419 KB | 140 KB | first paint |
| `index.css` | 48 KB | 11 KB | first paint |
| `markdown.js` (marked, DOMPurify) | 77 KB | 26 KB | when the explorer approaches |
| `ExperienceCanvas.js` (three, R3F, postprocessing, scenes) | 1,041 KB | 277 KB | on idle, after the page is interactive |
| `summary.json` | 24 KB | n/a | first paint |
| `tasks/<id>.json` | 11–107 KB each | n/a | when a bug is opened |
| fonts (Geist, Geist Mono, latin) | 29 + 23 KB | n/a | first paint |

## Lighthouse (v12, Playwright Chromium, headless)

**Desktop preset**, three runs on the final build:

| Category | Run 1 | Run 2 | Run 3 | Target |
| --- | --- | --- | --- | --- |
| Performance | 74 | 70 | 77 | 85 (**not met**) |
| Accessibility | 100 | 100 | 100 | 95 ✓ |
| Best practices | 100 | 100 | 100 | 95 ✓ |
| SEO | 100 | 100 | 100 | n/a |

Desktop metrics: FCP 0.5 s · LCP 0.7 s · CLS 0–0.001 (target < 0.1 ✓) · Speed Index 1.5 s ·
TBT 500–820 ms.

**Mobile preset** (emulated mid-range phone, 4× CPU throttle), two runs:

| Category | Run 1 | Run 2 | Target |
| --- | --- | --- | --- |
| Performance | 65 | 63 | 75 (**not met**) |
| Accessibility | 100 | 100 | ✓ |
| Best practices | 100 | 100 | ✓ |
| SEO | 100 | 100 | n/a |

Mobile metrics: FCP 2.0 s · LCP 2.9 s · CLS 0 · TBT 2.0–2.5 s.

Why performance misses its target: total blocking time. The remaining long tasks are evaluating the
main bundle (React and GSAP) and starting the 3D layer (scene construction and the first composer
frame). Under the 4× mobile throttle each takes 400–700 ms. The work already done is listed in
BUILD_LOG M10. The next steps, not done, would be: code-split GSAP so it loads only where pins
exist; build the shell geometry in a Web Worker; and start the 3D layer only on first interaction on
phones.

## Frame rate (measured, `scripts/qa/fps.mjs`)

Steady state, after scrolling settles. 1440 × 900 viewport, DPR 1, hardware GL (ANGLE/D3D11) on the
Intel Iris Xe:

| Section | fps | worst frame | Canvas rendering? |
| --- | --- | --- | --- |
| Hero (Signal Field) | 60 | 24 ms | yes |
| Hero split (six streams) | 60 | 20 ms | yes |
| Results | 60 | 18 ms | no (idle) |
| Matrix pin 30% / 70% | 60 / 60 | 19 ms | yes |
| Explorer | 60 | 19 ms | no (idle) |
| Pipeline pin 50% | 60 | 20 ms | yes |

Before the optimisations, the same machine measured 17 fps in the matrix and pipeline pins. When no
scene is on screen the canvas renders 0 frames (measured with a frame counter). High-DPR displays
(DPR up to 2) and software GL weren't measured for steady state. Under SwiftShader (no GPU) the 3D
runs at about 2–9 fps, and the no-WebGL poster is the intended path there.

## Accessibility findings

- **Contrast.** The locked muted token `#77716B` is 3.6–4.1:1 on the dark surfaces, which fails
  4.5:1 for small text. It's now used only for decoration (rules, diff line numbers);
  informational small text uses the secondary text token `#A8A29B`. Lighthouse accessibility is 100.
- **ARIA.**
  - Loading skeletons got `role="status"`, and mini status icons got `role="img"`.
  - The matrix is an ARIA grid with row and column headers and roving focus.
  - The chart rows are focusable buttons with full text labels, and the setup table is the chart's
    data equivalent.
- **Motion.**
  - `prefers-reduced-motion`: no pinned sequences and the scene starts paused; Resume is an opt-in.
  - CSS animations are disabled.
  - Pause is always available while a scene is on screen.
- **Non-colour status.** ✓/✗ glyphs and "Resolved"/"Failed" text accompany colour everywhere; matrix
  cells show 2/2, 1/2 and 0/2.
- **Keyboard.**
  - Skip link, visible Ember focus rings, and nav moves focus to the section heading.
  - Interact mode works by keyboard: arrows rotate, +/− zoom, Esc exits.
- **3D.** The canvas is `aria-hidden`, and every fact in it (counters, setups, bands, stages) is also
  in the DOM. Hotspots are real buttons.

## Visual self-assessment (1–10, from screenshots under `qa-screenshots/`, git-ignored)

| Criterion | Score | Notes |
| --- | --- | --- |
| Brand identity consistency | 9 | Obsidian/Ember tokens throughout; Ember only marks meaning; spectral colours only in 3D. |
| Hero composition | 9 | Readable at first paint, CTA above the fold at 1440 × 900, field occupies the right half. |
| 3D visual quality | 8 | Layered, triangulated, organic membranes, warm core, strands and dust, close in spirit to the reference; the exploded split state is busier than ideal. |
| Shader/material quality | 8 | Multi-frequency noise, spectral ramp following the folds, pole fade, selective bloom. |
| Scroll storytelling | 8 | Three coherent pinned sequences (field → streams, sheet → grid, pipeline build), desktop-only where pins would trap content. |
| Data visualisation clarity | 9 | Interval plot leads with uncertainty and detectability; no raw-rate bars. |
| Explorer usability | 9 | Reads like a developer tool: issue, run rail, hook terminal, diff with line numbers, A/B compare. |
| Animation smoothness | 8 | 60 fps steady on an integrated GPU; there is a one-time start-up hitch. |
| Typography and spacing | 9 | Geist/Geist Mono hierarchy, editorial section heads, consistent spacing. |
| Mobile experience | 8 | Stacked field band, vertical pipeline, swipeable matrix, icon controls, no overflow. |

## Known remaining limitations

- Lighthouse performance is below target (desktop 70–77, mobile 63–65), with TBT as the cause; see
  above.
- The featured example's web exposure isn't verified (`.uplift/` web-audit data isn't on this
  machine). The page says so.
- The footer omits the repository link because `github.com/EshanGoel07/uplift` returned 404 (private)
  on 2026-11-02. Set `REPO_URL` in `src/sections/Footer/Footer.tsx` once it's public.
- `SUBMISSION.md` (outside `site/`) mentions a third teammate building the results page; the team
  says it's two people. That's for the team to correct.
- The Python test suite wasn't run here (no pytest or venv on this machine).
- Steady-state frame rates were measured on one GPU at DPR 1 only.
- The three-stage pinned scroll is desktop-only by design (≤900 px gets a still hero and an unpinned
  pipeline).

## Confirmation

`git status` shows changes only under `site/`. No experiment code, analysis code, `scripts/paid.sh`,
`tools/budget_guard/`, `.claude/` or model configuration was touched, and no paid command was run.
