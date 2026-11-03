# Build log: Uplift results website

Built 2026-11-02. Every file is inside `site/`. Nothing outside `site/` was modified, no paid command
was run, and `data/results.json` is unchanged (sha256 `5f69ac40…7e34f7`).

## M0: Repository audit · complete

- **Objective.** Understand the brief, the data and the constraints before writing code.
- **Read.**
  - Brief and source data: `BRIEF.md`, `data/results.json` (schema, types, sizes).
  - Report and history: `reports/main.md`, `SUBMISSION.md`, `PHASE_LOG.md`, `NOTICE.md`.
  - Instructions and CLI: `CLAUDE.md` (repo and parent), `src/uplift/cli.py` (real command names).
- **Findings.**
  - `site/` held only `BRIEF.md` and `data/results.json`, so there was no existing app to preserve.
  - The root `.gitignore` ignores any folder named `dist/`, `build/`, `runs/` or `meta/`. Source
    folders avoid those names; `dist/` is the intended, ignored build output.
  - `.uplift/` (working data, including the per-run web audit) isn't on this machine, so the featured
    task's web exposure can't be verified. The page says so in a footnote.
  - `https://github.com/EshanGoel07/uplift` returned HTTP 404 (private), so the footer doesn't link
    it yet (`REPO_URL` TODO in `Footer.tsx`).
  - The visual reference supplied by the team is a screenshot of another company's site. It is used
    for style only; no branding, text or layout is copied.
  - The team is two people (Aryan Kansal, Eshan Goel). `SUBMISSION.md` mentions a third teammate
    for the results page; that is flagged to the team and left unedited (outside `site/`).

## M1: Data architecture · complete

- **Files.**
  - `scripts/split_results.py`: standard library only, deterministic, checks the source hash.
  - Data layer: `src/data/{types,load,format,classify,arms,reportFigures}.ts`.
  - Tests: `tests/unit/data.test.ts`, `tests/unit/format.test.ts`.
- **Decisions.**
  - `summary.json` (24 KB) holds everything the page needs at first paint. The 77 task files load
    only when a bug is opened, and are cached.
  - Groups (always / mixed / never) and wins/losses are computed from the data, never hardcoded.
  - Figures that aren't in the JSON live in `reportFigures.ts`, each with its source.
- **Tests.**
  - 924 runs, 77 tasks, 6 arms, 154 attempts each, 2 runs per pair; groups 43/23/11.
  - Arm `solved` equals the sum over tasks; costs sum to $21.31.
  - Task files equal the source and the raw copy is byte-identical; summary is under 50 KB.
  - Wins/losses (computed) equal the report's 6/4, 7/6, 6/7, 4/7, 3/3.
  - The robustness table's first row equals `results.json`, and every interval crosses zero.
- **Results.** All pass. Running the script twice gives identical output hashes.

## M2: Design system · complete

- **Files.** `src/styles/tokens.css`, `src/styles/app.css`, the nav, controls and section-head
  components.
- **Decisions.**
  - The exact Obsidian/Ember tokens are CSS variables. Ember is used only for brand, selection, the
    active nav item, key callouts and the web-leak card. Spectral colours appear only in `scenes/`.
  - Geist and Geist Mono are bundled through `@fontsource-variable` (no CDN).
  - Tailwind was **not** added: plain CSS with the tokens was simpler and kept one system.
- **Accessibility finding.** The locked muted token `#77716B` measures 3.6 to 4.1:1 on the dark
  surfaces, below 4.5:1 for small text (Lighthouse). The token is kept for decoration (rules, diff
  line numbers) and informational small text uses `#A8A29B`. Lighthouse accessibility went from 94
  to 100.

## M3: Signal Field · complete

- **Files.** `src/scenes/SignalField/{geometry,materials,SignalField,hotspots,hotspotRegistry}.ts(x)`,
  `src/scenes/shaders/noise.ts`.
- **Implementation.**
  - **Geometry.** Three open, ragged spherical shells. Each rim's opening varies with two sine
    harmonics per layer. Line indices include rings, meridians and one diagonal per quad, giving a
    dense triangulated wireframe that shares vertices with a faint surface fill.
  - **Vertex shader.** 3D simplex noise at three frequencies, rim folds, breathing, and a pointer
    bump computed in world space. Each layer has its own phase and frequency.
  - **Fragment shader.** A spectral ramp (cyan → blue → violet → magenta) driven by position and
    displacement. Rims trend cyan and the core-facing pole is warm. The pole fades, because
    converging meridians saturated to white (seen in the first screenshot).
  - **Other parts.**
    - A warm core sphere (values above 1 feed the bloom) and a halo sprite.
    - 120 strands with a travelling pulse; about 14% are bright enough to bloom.
    - Spectral dust plus a far starfield.
    - Selective bloom with threshold 0.92.
  - **Hotspots.** Four counters from the data (39 test bugs, 38 fresh bugs, 12 runs per bug,
    2 Meta models). They are real DOM buttons positioned by projecting 3D anchors each frame, and
    they open a detail card.
- **Interaction.**
  - Pointer deforms the surface and brightens nearby strands.
  - Interact mode: drag to rotate, wheel or +/− to zoom, arrows to rotate, Esc to exit. It is only
    active in this mode, so page scrolling is never trapped.
  - Pause, Resume and Reset (damped back to the start).
- **Fallbacks.**
  - Low tier (≤760 px or ≤4 cores): fewer segments and particles, no bloom.
  - Reduced motion: starts paused on a composed still frame.
  - No WebGL: a JPEG poster captured from the live render by `scripts/capture-poster.mjs`.
- **Iterations, from screenshots.** Overexposed core and pole, then too spiky, then hotspots
  unreadable over the mesh, then hotspots clipped at the viewport edge. Each was fixed and
  re-checked.

## M4: Hero and scroll · complete

- **Pinned sequence A** (desktop with WebGL, no reduced motion), over 140% of a viewport:
  - The field deforms and drifts left.
  - It emits six GPU particle streams along Bezier paths. Each stream ends at its setup's DOM label,
    because the endpoints are unprojected from the label anchors.
- **Small screens.** The field sits in a band above the text and there is no pin, so the content is
  never trapped inside a pinned screen.
- **Bugs found and fixed.**
  - GSAP scopes selector strings to the context, so `'#results'` wasn't found. The fade trigger
    defaulted to the body and hid the scene at load. It now uses element references.
  - Pins created at different times (some wait for data) refreshed out of order. Fixed with
    `ScrollTrigger.sort()` before every refresh.
  - A nav jump landed short when the explorer's task loaded mid-scroll. `jumpTo` now re-aims after
    the scroll settles. This was caught by the e2e test.

## M5: Results visualisation · complete

- **What's built.**
  - A custom SVG dot-and-interval plot from −10 to +10 points, with a bold zero line labelled
    "No setup (72.7%)" and no interval drawn for the baseline.
  - A hatched 5.4–9.1 band, plus per-setup dashed ticks at each setup's own detectable effect.
  - Hover and focus tooltips (estimate, CI, n, won/lost, detectable). Click or keyboard selects up
    to two setups for a side-by-side comparison, with a note that the study didn't test setups
    against each other.
  - An arm table (descriptions, rate with its CI, cost per solved, regressions, computed won/lost),
    the cost strip ($21.31, $0.023 per run, $29.78 of a $100 cap) and the takeaway callout.
- **Removed `d3-scale`.** Only a linear scale was used, and the package pulled in time and format
  modules; it's replaced by a five-line helper.

## M6: Bug matrix · complete

- **HTML grid.** A real 77 × 6 ARIA grid in computed bands, each cell showing 0/1/2 as shade plus
  numerals.
  - Filters for set, outcome and hooks, plus search.
  - Tooltips, roving-tabindex keyboard navigation, and Enter or click to open the explorer.
  - Horizontal scroll inside its own container, with a swipe hint on small screens.
- **3D intro (pinned sequence B).** 462 instanced tiles in the same order and bands, starting on a
  rippling curved sheet and unfolding left to right.
  - The flat state is laid out from the DOM band labels' rectangle, so the bands line up exactly.
    This was misaligned by the container padding at first, found by screenshot.
  - Tiles: 2/2 calm cyan-blue, 1/2 warm amber, 0/2 violet.
- **Lazy rendering.** The HTML grid renders when the section approaches, which keeps first paint
  light.

## M7: Bug explorer · complete

- **Featured task** `tobymao__sqlglot-fresh-63296846` ("Sqlite ParseError … for WINDOW").
  - Every claim was checked against the data: no setup 0/2, tips + hooks 2/2, co-change warnings
    plus one ruff reminder, the agent changed only `sqlglot/parser.py` (plus a test in one run).
  - Added the counterexample: Hooks (generated) also got messages and failed both runs.
  - Not presented as causal, with a footnote that web exposure couldn't be verified.
- **Layout.**
  - Header: id, title, set, PR link for test ids only, and an explicit note for fresh ids.
  - Sanitised issue markdown, collapsed past 15 lines.
  - Arm rail with ✓/✗ run pills (a hook dot where hooks spoke); run facts; hook terminal.
  - Diff viewer with line numbers, +/− styling, file stats and expand/collapse.
  - Compare mode (A/B side by side), and a bug picker covering all 77 tasks.
- **Safety and loading.**
  - Diffs are React text nodes, never `innerHTML`.
  - marked and DOMPurify load lazily: `img`, `svg`, `iframe`, `form` and `style` are forbidden,
    `on*` handlers stripped, links limited to http(s) and mailto. Tested with hostile input and
    with all 77 real issues.

## M8: Trust and methodology · complete

- **Trust.**
  - Six cards from the data; the fifth is retitled exactly "We caught and measured web leaks", with
    its detail kept.
  - The investigation panel:
    - The tier table, with "80 = 59 + 21" explained and the other 23 exposure runs kept separate.
    - Per-setup and per-set counts, and the lower-bound note.
    - The four-view robustness table, with "every 95% interval still crosses zero".
  - Detail cards: the three hidden-failure formats the fail-closed grader caught (taken from
    `PHASE_LOG.md`), stale bytecode, screening, the proxy and hook delivery, and rule-based failure
    facts. The unreliability of the Muse Spark labels is stated; the labels aren't shown as causes.
- **Methodology.**
  - Five real stages, with facts and command names checked against `cli.py` and `paid.sh`.
  - Pinned sequence C on desktop: modules activate with scroll, and clicking a module (raycast) or
    a stage button highlights it and its link.
  - Modules: particles assemble into task cubes; a timeline is cut into dev and test; a risk graph;
    a core emitting six setups; two repeat streams through a grading gate.
  - Horizontal on desktop, vertical on phones. A plain HTML five-step list is always present.

## M9: Remaining content · complete

- Built vs used, crediting Aryan Kansal and Eshan Goel; licences from `NOTICE.md`.
- All 8 limitations always visible, plus 2 extras.
- Future work styled as "Planned, not built".
- Footer with the sqlglot caveat and a raw-data link that resolves under the sub-path. The repo link
  is a TODO because the repo is private.

## M10: Responsiveness, accessibility, performance · complete (targets partly met)

- **Responsive.** Checked at 1440, 820, 768, 390 and 375 px. No page-level horizontal overflow
  (tested). Controls are icon-only on phones.
- **Performance work, measured with Lighthouse and the CPU profiler.**
  1. The 4× multisampled half-float composer was too heavy for an integrated GPU, so multisampling
     is off and bloom uses 6 levels. Matrix and pipeline went from 17 to 60 fps.
  2. `compileAsync` before the first frame, with an offscreen target bound, because composer
     rendering changes the program keys. The first attempt without the target was wasted.
     Synchronous linking went from about 1.5 s to about 0.5 s.
  3. A cheap WebGL feature check instead of a throwaway context (about 110 ms saved). Runtime
     failures fall back through an error boundary.
  4. The 3D chunk mounts on idle. Matrix and pipeline scenes mount when near; the streams mount
     after the first frames.
  5. The markdown libraries load lazily; `d3-scale` was removed.
  6. Tried and reverted: deferring bloom made the first frame miss the precompiled programs (worse).
- **Results.** See `QUALITY_REPORT.md`.

## M11: Final QA · complete

- `npm run typecheck`, `npm test` (25/25), `npm run build`, `npm run e2e` (15/15, against the
  production build under `/uplift/`).
- Screenshots of every section at desktop, tablet and phone sizes, plus the pinned states.
- The repo-root `python -m pytest -q` couldn't run on this machine: pytest isn't installed and no
  virtualenv is present. Nothing outside `site/` changed, so the Python suite isn't affected.
