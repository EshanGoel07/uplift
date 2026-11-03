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

## Phase 1 (2026-11-03): data sync and research accuracy · complete

Content only; layout and styling unchanged.

- `npm run data` re-run: all 80 files under `public/data/` came out byte-identical (source sha
  `42364bef…`).
- Arm descriptions now come from `results.json` (`Arm.description`); the hardcoded `src/data/arms.ts`
  was removed. Labels are the data's own.
- Featured WINDOW note: the 7 shortcut / 4 look-ahead / 1 other story, the `SELECT col window FROM t`
  assertion (sourced to README and PHASE_LOG, not to public data), and the documented web-clean audit
  result in place of "could not be verified". A unit test checks the run counts and hook messages
  against `results.json`.
- Web-leak card, investigation and Limitations: the Phase 6 network block (new runs only; the 924 were
  not re-run) and the open filesystem gap.
- Dates: Oct 27 – Nov 4, 2026. Licence sentence matches NOTICE.md (SWE-rebench issue texts included
  under CC-BY-4.0).
- Repository link in the header and footer, NOTICE.md link, and a demo-video placeholder, all from
  `src/data/links.ts`.
- Provenance comments no longer cite the removed `SUBMISSION.md`.
- Checks: `npm run typecheck`, `npm test` (28/28), `npm run build`, `npm run e2e` (15/15).

## Phase 2 (2026-11-03): design foundation, navigation, hero and findings · complete

- **Identity.** Publication palette and type scale in `tokens.css` (`--p-*`), styles in
  `styles/publication.css`, scoped to the new header, hero and findings (`.pub`). Sections not yet
  redesigned keep the dark tokens until their phase.
- **Header.** "Uplift" wordmark, six sentence-case links in page order (Overview, Findings,
  Experiment, Worked example, Explore runs, Integrity), GitHub and a demo-video placeholder. Below
  981 px a Menu disclosure (Escape closes and returns focus). Page order now follows the nav.
- **Hero.** Question, the central finding with its 5.4–9.1 point qualification, four study numbers,
  the two Muse models, byline. Figure 1 is an SVG drawn from the data's dimensions: 77 bug columns ×
  6 condition rows × 2 run ticks = 924, with one bug highlighted across every condition.
- **Removed:** Signal Field, Experiment Streams, hero hotspots, floating scene controls, the hero pin,
  the blinking caret, the poster image and its capture script. The 3D chunk now loads only near the
  method and matrix sections.
- **Findings.** The dot-and-whisker chart is kept (zero line, 95% paired intervals, per-setup
  detectable ticks, 5.4–9.1 band), redrawn on white with no entrance animation and one colour for all
  rows. The floating tooltip became a readout below the plot. Paired-design passage, a prominent
  smallest-detectable-effect panel, captions, Table 1 with a sticky first column on phones.
- **Checks.** typecheck, `npm test` 28/28, `npm run build`, `npm run e2e` 15/15 (tests rewritten for
  the new header, hero figure, readout, mobile menu and no-WebGL hero). Review screenshots:
  `scripts/qa/review-shots.mjs`.

## Phase 2b (2026-11-04): a data-driven 3D hero · complete

Review feedback: the light redesign read as generic and plain once the 3D was gone. The 3D came back
as the data itself, not as decoration.

- **Run lattice** (`scenes/RunLattice/RunLattice.tsx`, `components/figures/HeroStage.tsx`): all 924
  runs as instanced cubes, six condition lanes crossing all 77 bugs, two cubes per bug per lane.
  Landscape frames show two blocks (39 test bugs in front, 38 fresh behind); portrait frames look down
  the lanes. A fitted camera (projected corners and a view offset) frames it at any size.
- **Two views.** Design: neutral, with the featured bug as a blue band across every lane (pairing).
  Outcomes: each cube takes its run's real result. It switches once on its own after the build-in,
  only when on screen; the reader's choice wins after that. The caption states the data-backed
  reading: in 54 of 77 bugs all 12 runs agree; only the 23 mixed bugs can separate setups.
- **Interaction:** hover lifts a bug's band and fills the readout (per-setup results from the data);
  click opens the bug in the explorer; arrow buttons step through bugs without a pointer. The camera
  follows the pointer slightly and rises toward a plan view as the hero scrolls (no pin).
- **Dark stage** hero with a technical grid; the header turns dark while over it. Findings gained a
  grid-paper background and intervals that draw in from zero (skipped for reduced motion).
- Fallbacks: no WebGL, or a WebGL failure, shows the SVG version of Figure 1. Reduced motion starts on
  Outcomes with no animation.
- Cost: three.js and R3F now load for the hero (shared chunk 919 KB, 243 KB gzip), after first paint.
- Checks: typecheck, `npm test` 28/28, build, `npm run e2e` 15/15 (new lattice test).

## Phase 3 (2026-11-04): the experiment workbench · complete

Replaces the Methodology section, its 260% pin, the PipelineEngine scene and the three repeated
stage lists.

- **One authoritative method file**, `src/data/method.ts`: the agent prompt (runner.PROMPT, verbatim),
  the stripped agent files (workspace.AGENT_PATHS), workspace and grading steps, what each side of the
  information barrier sees, task sources, and what each condition installs. `tests/unit/method.test.ts`
  checks the prompt, the stripped paths, tips/hooks per arm (generate.ARMS) and the 60-line generic file
  against the Python source. Labels and descriptions still come from results.json.
- **3D model** (`scenes/Workbench/`) in the shared ExperienceCanvas, laid out over a DOM stage:
  A task source (77 tiles in test | fresh, the 40 dev tasks on a separate tray with a dashed link to the
  tuned lane only); B six lanes, each with a setup module showing what it installs (AGENTS.md plate,
  hook ring, both, a generic plate) and two repeat channels; C twelve glass workspaces (snapshot, issue
  card, assigned setup, patch); D the barrier wall with one patch slot per run; E the evaluator with the
  hidden-test block and one lamp per run; F the paired analysis bars against No setup's score. Lamps and
  bars come from the selected bug's real task file. Gentle perspective (drawn far back, scaled up).
- **Labels are real buttons** projected onto the model, so every module, lane and side is reachable by
  keyboard. Clicks reach the model only on the bare stage (the shared canvas listens page-wide and
  three.js raycasts hidden objects); a regression test covers it.
- **Barrier switch** ("What the agent sees | What the evaluator sees"): the other side steps back, and the
  inspector shows the verbatim prompt and what is never given to the agent, or the grading steps.
- **2D diagram** (`WorkbenchDiagram.tsx`), the default on phones and without WebGL: the same modules as an
  HTML schematic, every part a button, rows per condition with the real outcomes.
- **Inspector** below the stage; one written method (5 short steps) under it. Normal scrolling, no pins.
  Task files load only when the section approaches.
- Checks: typecheck, `npm test` 32/32, build, `npm run e2e` 17/17 (two new workbench tests).

## Phase 4 (2026-11-04): the WINDOW worked example and the explorer upgrade · complete

- **Worked example** (`sections/WorkedExample/`, `#explorer`): the bug and its compatibility
  requirement (`SELECT col window FROM t`), the task card with the sanitised issue, Figure 4 (all twelve
  runs in six equal condition groups, results 0/2 0/2 0/2 2/2 1/2 1/2 from the task file, an approach
  tag per run, nothing preselected), Figure 5 (Shortcut 7/0, Look-ahead 4/4, Other 1/0, each with a
  real patch and a run switcher; A and B side by side), the hook evidence (the verbatim co-change
  message and the four runs that received it, from the data), the web-audit line with its provenance
  (README, PHASE_LOG; no raw traces in the JSON), and the central point.
- **Approach labels**: `FEATURED_APPROACHES` in `reportFigures.ts`, sourced to the README;
  `tests/unit/tasks.test.ts` re-derives them from the diffs and checks all 77 task files (924 runs).
- **Explorer** (`#explorer-all`): searchable picker of all 77 bugs grouped by outcome band with each
  bug's six-condition pattern; shared `RunBoard`; neutral default (No setup, repeat 1); A/B compare;
  phones get a collapsible picker, condition accordions and collapsible run details. `openTask` from the
  hero, workbench and matrix now lands here.
- **Diff viewer**: per-file blocks with sticky paths, hunk headers, old/new line numbers and a small
  safe Python highlighter (text spans only). Hook messages are styled as messages, not code; the
  `verify` line tag no longer matches any line containing "test".
- Legacy dark explorer CSS removed; styles in `styles/explorer.css`.
- Checks: typecheck, `npm test` 36/36, build, `npm run e2e` 19/19 (three new explorer tests).

## Phase 5 (2026-11-04): the rest of the page and the visitor journey · complete

- **Journey**: Question → Findings → Experiment → Worked example → Explore runs (matrix, then the
  explorer) → Integrity → Limitations, Built vs used, Future work → Footer. Each section ends with a
  one-line `Bridge` to the next. Nav gains **Limitations**; with seven links the bar switches to the
  menu below 1060px (CSS and the menu's close-on-widen query agree).
- **Matrix** (`#matrix`): 3D intro and the 150% scroll pin removed. A data-driven ceiling bar
  (43 · 23 · 11) explains why only the 23 mixed bugs can separate conditions; on phones it shows the
  counts only and the caption names the groups. Filters, search, keyboard navigation and
  open-in-explorer kept.
- **Integrity** (`#trust`): "We checked for ways the experiment could mislead us." The six trust cards
  are kept as the overview. The leak card is shortened to a link into the investigation, so the
  network-block detail isn't said twice. The investigation is a six-step timeline: default network,
  the audit (80 of 924, a lower bound; 37 web fetch only, 30 shell only, 13 both), the four
  sensitivity views, the probe-verified block, not re-run, and the filesystem gap. Below it: grader,
  screening, contamination controls, metering, and the failure-rule table, each linked to its source file.
- **Method**: an 8-part technical explanation under the workbench, each part linked to the real file.
- **Limitations**: 13 points in four groups, synced with the README and PHASE_LOG. Artifacts is
  placed before Measurement so the two CSS columns balance (6 and 7 points).
- **Built vs used**, **Future work** (five items, each "Planned, not built") and **Footer** rewritten.
  The demo video stays plain text until `DEMO_VIDEO_URL` is set.
- **Phones**: wide integrity tables scroll inside their frame with a swipe hint instead of squeezing
  labels to one word per line. Table 2's caption sits outside the scroll frame. The probe output
  wraps. The credits table becomes one block per tool.
- **Number check**: every figure written into these sections was checked against README.md,
  PHASE_LOG.md and reports/main.md: exposure tiers and per-arm counts, Table 2, failure rules, hook
  delivery, screening, repeat noise, 5.4–9.1 detectable range, 0.65, 1,220, $21.31. All match.
- The meta description no longer reads "No setup was shown to differ from no setup".
- Legacy section CSS removed from `app.css`; new styles in `styles/sections.css`.
  `SectionHead` deleted (unused).
- QA: `scripts/qa/page-shots.mjs` captures each later section and the full page at desktop, tablet
  and mobile, and reports console errors and horizontal overflow (none).
- Checks: typecheck, `npm test` 36/36, build, `npm run e2e` 22/22. Three new tests: ceiling bar,
  limitations order, footer links. The integrity test now also covers the timeline, the source links
  and the failure table.
