# Uplift redesign audit (Phase 01, read-only)

2026-11-04. Nothing in source, CSS, dependencies, config, generated data or git history was changed.
The build and the end-to-end tests ran against a copy built in a temporary folder, not `site/dist`.
The colour and theme findings are in [UPLIFT_ORIGINAL_IDENTITY_AUDIT.md](UPLIFT_ORIGINAL_IDENTITY_AUDIT.md)
and are not repeated here.

**How to read references.** `path:line` refers to the working tree. `09549a9:path` is the first
committed site (`git show 09549a9:site/<path>`), which holds the original scenes that the working
tree has deleted.

---

## 1. Architecture map

```
Python pipeline (src/uplift/)                        Website (site/)
───────────────────────────────                      ─────────────────────────────────────────
tasks.py / mine.py ─► split.py ─► risk.py            data/results.json  (export target)
        │                          │                       │  scripts/split_results.py
        ▼                          ▼                       ▼
generate.py / tune.py ─► arms ─► workspace.py        public/data/summary.json   (eager, App)
        │                          │                 public/data/tasks/<id>.json (lazy, loadTask)
        ▼                          ▼                 public/data/results.json   (raw download)
runner.py / batch.py ─► grade.py ─► analysis.py ──►        │
        └─ netprobe.py, webaudit.py, screen.py,            ▼
           label.py, report.py ─► reports/main.md ──► src/data/reportFigures.ts (hand-copied numbers)
```

| Stage | Code | Notes |
|---|---|---|
| Task source (SWE-rebench) | `src/uplift/tasks.py:109 load_swe_rebench` | parquet download, `Task` dataclass :29 |
| Fresh bug mining | `src/uplift/mine.py:287 mine` | needs a `fix:` subject (:35, :61), 1–5 library `.py` files + tests, a linked issue (:76, :103); F2P/P2P measured by running the tests (:172, :226) |
| Split and leak check | `src/uplift/split.py:58 make_split`, `:87 leakage_at`, `:103 check_leakage` | chronological, dev vs test |
| Validation | `src/uplift/runner.py:81 validate`, `batch.py:86` | F2P must fail before the fix and pass after it, on every repeat |
| Screening | `src/uplift/screen.py:182 judge`, `:218 apply_rule` | an LLM checks the issue against the F2P tests |
| Commit processing | `src/uplift/risk.py:44 read_history` | `git log --no-merges --numstat -M` up to the snapshot |
| Risk map | `src/uplift/risk.py:103 build_risk_map`, `:77 szz_lite` | recency-weighted fixes + churn (180-day half-life) + SZZ-lite; mean of percentiles |
| Co-change rules | `src/uplift/risk.py:136-163` | support ≥ 5, confidence ≥ 0.5 → `co_change_rules` |
| Source→test map | `src/uplift/risk.py:160, :182` | → `tests_for_source` |
| Setup generation | `src/uplift/generate.py:37 ARMS`, `:135 collect_inputs`, `:67 assert_before`, `:261 render_arms` | writes AGENTS.md, `.muse/hooks.json`, hook config, `uplift_hook.py`, MANIFEST.json |
| Hook runtime | `src/uplift/arm_hooks/uplift_hook.py` (`lint` :60, `cochange` :81, `related_tests` :91, `verify` :113) | each firing is logged to `fired.jsonl` |
| Six reported conditions | `src/uplift/batch.py:30 REPORT_ARMS`; labels `analysis.py:22` | `none, prose, sensors, both, handwritten, tuned`. `handwritten` = `arms/handwritten/AGENTS.md` |
| Dev→tune branch | `src/uplift/tune.py:39 assert_dev_only`, `:78`, `:143 render` | dev tasks only; one `tuned` arm |
| Isolated workspace | `src/uplift/workspace.py:28 create` (`git archive` → one-commit repo), `:82 install_arm`, `:112 agent_diff` | no history in the workspace |
| Information barrier | `src/uplift/runner.py:20 PROMPT` (issue only); `grade.py:161 reset_test_files`, `:172-175` | the hidden test patch is applied only at grading |
| Fail-closed grader | `src/uplift/grade.py:90 check_output`, `:183-185`; `runner.py:145 infra_failure` | a mismatch with pytest's summary, a missing summary or a timeout counts as unresolved |
| Network restriction | `src/uplift/runner.py:39-47`, `src/uplift/netprobe.py` | added after the 924 runs (see `NETWORK_BLOCK` in `reportFigures.ts`) |
| Web-exposure audit | `src/uplift/webaudit.py:28` tiers, `:84 classify`, `:143 trust_summary` | |
| Paired statistics | `src/uplift/analysis.py:101 per_task`, `:117 bootstrap`, `:107 percentile_ci`; MDE `report.py:34` | paired task-level bootstrap, 10,000 resamples, seed 20261101, percentile 95% CI |
| Export | `src/uplift/analysis.py:252 export` → `site/scripts/split_results.py:37 main` | the export checks costs against the ledger; split requires exactly 2 runs per arm |

**Site runtime.**
- `src/main.tsx` imports 6 stylesheets.
- `src/app/App.tsx` renders `Nav`, then 10 sections, then `Footer` and `BackToTop`.
- `ExperienceCanvas` is lazy-loaded and mounts when `#method` comes within one viewport (`App.tsx` IntersectionObserver).
- State lives in `src/state/sceneStore.ts` (`ui`, `live`) and `workbenchStore.ts`, both small external stores.
- Data loads through `src/data/load.ts`: `summary.json` once, and task files on demand with caching.

## 2. Scene map

No scene in either version shows a repository, filesystem, file tree or commit history. Searches of
`09549a9` and the working tree found none. The closest thing is the "risk graph" module inside the
old PipelineEngine, which is 16 seeded-random nodes. If the original recording shows such a view,
its source is not in this checkout.

### Original (`09549a9`): one shared canvas, three GSAP pins

| Scene | Purpose | Data | Interaction | Animation / scroll | Cost | Fallback |
|---|---|---|---|---|---|---|
| **SignalField** (`scenes/SignalField/*`) | Hero Nebula: three noise-deformed wireframe shells, warm core, halo, strands, dust | Procedural. The 4 hotspot counters come from `summary.json` (test/fresh counts, arms × 2) plus a hard-coded "2 meta models" (`hotspots.ts:6-19`) | Pointer pushes the shells; real DOM hotspot buttons positioned by the scene; drag, wheel and arrow-key orbit through `SceneControls` | Time + scroll. Pin `.hero__pin` +140%, scrub 0.6 (`Hero.tsx:24-34`); deform over progress 0–0.5, split over 0.42–0.88 | Always mounted; fewer segments and particles on low tier | Poster JPG (now deleted) |
| **ExperimentStreams** | Six particle streams from the core to DOM anchors | **None**: six fixed colours | None | Shader time; uses the hero pin | 1,560 particles; `getBoundingClientRect` every frame | none |
| **MatrixSurface** | The real 77×6 grid, unfolding from a rippling sheet onto the HTML grid | `summary.tasks[].solved[arm]`, `sortForMatrix` | Orbit only | Pin +150%, scrub 0.6 (`BugMatrix.tsx:29-51`) | 462 instances | HTML grid; off for reduced motion |
| **PipelineEngine** | Five method stages (mine, split, risk graph, generate, run/grade) | Seeded random. The rate 0.727 is hard-coded "for flavour" (`:328`) | Click a module | Pin +260%, scrub 0.5 (`Methodology.tsx:18-49`) | ~480 particles | DOM stage text |

Mounting (`09549a9:scenes/ExperienceCanvas.tsx`):
- frameloop `never` until shaders compile, then `always` while a scene is active, otherwise `demand`.
- dpr [1, 1.5] on low tier and [1, 2] otherwise; Bloom off on low tier.
- Reduced motion starts paused at time 14.

### Current (working tree): two canvases, no pins, no ScrollTrigger

| Scene | Purpose | Data | Interaction | Animation / scroll | Cost | Fallback |
|---|---|---|---|---|---|---|
| **WorkbenchScene** (`scenes/Workbench/WorkbenchScene.tsx`, in the shared `ExperienceCanvas`) | Model board, modules A–F: task source, 6 lanes × 2 repeats, 12 workspaces, information barrier, evaluator, paired analysis | `summary.tasks`, `summary.arms`, `CONDITIONS` (`data/method.ts`), per-run `resolved` via `loadTask`; the **40 dev tiles are hard-coded** (`:118, :291`) | Click a module → `wb.focus`; projected DOM label buttons; toolbar (bug select and stepper, agent/evaluator, 3D/2D, Reset) | Only the barrier dimming; `workbenchVis` from a scroll/resize rect (`Methodology.tsx:65-78`) | 77 + 40 instances; Bloom on (not low tier) | `WorkbenchDiagram` (2D) on narrow screens or without WebGL |
| **RunLattice** (`scenes/RunLattice/RunLattice.tsx`) | Hero figure: 924 runs as cubes, 6 lanes × 77 bugs × 2 | `tasks[].set`, `tasks[].solved[arm]`, `arms[0].attempts` | Hover lifts a bug, click opens it; pointer parallax; DOM stepper, Design/Outcomes toggle, "Open its 12 runs" (`HeroStage.tsx:83-140`) | Time-driven build-in and colour sweep; camera elevation from a plain scroll listener (`HeroStage.tsx:59-68`) | **Its own `<Canvas>`** (`:271`), `frameloop="demand"`, 924 instances, antialias | `ExperimentOverview` SVG |

### Retain vs redesign

| Scene | Retain | Redesign |
|---|---|---|
| SignalField | Shell/core/halo geometry and materials, `SPECTRAL_RAMP` (`scenes/shaders/noise.ts`, still present), the hotspot-as-DOM-button pattern, low-tier scaling | Turn it into the 77-bug Nebula atlas: one addressable point per real task (set, group, per-arm solved), replacing the 4 counter hotspots |
| ExperimentStreams | The six-colour `STREAM_COLORS` idea | Drop it as decoration; if streams return, they must carry the real condition data |
| MatrixSurface | The data mapping and the 3D↔HTML alignment idea | Only if Phase 05 calls for it |
| PipelineEngine | Nothing data-wise (random values) | Superseded by the Bench and Repository Anatomy |
| WorkbenchScene | The data wiring, focus/inspector model, DOM label buttons and 2D fallback | Dark identity materials (it has ~25 hex literals); becomes the Experiment Bench |
| RunLattice | The data mapping and the 924-instance mesh | Move it into the shared canvas (one-canvas rule) and fix the lifecycle issues in §7 |

## 3. Section map (`App.tsx` order)

| # | Section (`id`) | Components | Data source | Interactive state | Scroll | Preserve | Replace |
|---|---|---|---|---|---|---|---|
| 1 | Hero (`overview`) | `Hero`, `HeroStage`, `RunLattice`, `ExperimentOverview` | summary; `DETECTABLE_MIN/MAX` | Bug stepper, Design/Outcomes, open task | Scroll listener → camera | Null-result statement, four study numbers, the SVG fallback | Becomes 01 Nebula |
| 2 | Results (`results`) | `Results`, `IntervalChart` | `summary.arms`, `reportFigures` | Row select/compare (keyboard) | Intervals draw in (in view) | Chart semantics: zero line, 95% paired CIs, detectable band | Styling only |
| 3 | Methodology (`method`) | `Methodology`, `WorkbenchScene`, `WorkbenchDiagram`, `Inspector` | summary, `loadTask`, `CONDITIONS` | Focus module, bug, agent/evaluator view, 3D/2D | Visibility only | The whole data model and inspector | Becomes 03 Experiment Bench |
| 4 | Worked example (`explorer`) | `WorkedExample`, `DiffViewer` | `loadTask(FEATURED_TASK)`, `FEATURED_APPROACHES` | Run pick per approach | none | Three-approach structure, real diffs, provenance notes | Becomes 04 WINDOW |
| 5 | Bug matrix (`matrix`) | `BugMatrix` | summary tasks, `classify.ts` | Filters, keyboard grid, cell opens explorer | none | Everything; e2e covers it | Styling |
| 6 | Explorer (`explorer-all`) | `BugExplorer`, `RunBoard`, `RunPanel`, `Issue`, `DiffViewer` | `loadTask` | Search, task select, compare, accordions | none | Sanitised markdown (DOMPurify, `utils/markdown.ts`) and safe highlighter | Styling |
| 7 | Trust (`trust`) | `Trust` | `summary.trust`, `reportFigures` | none | none | Content | Styling |
| 8 | Built vs used (`built`) | `BuiltVsUsed` | `links.ts` (static text) | none | none | Content | Styling |
| 9 | Limitations (`limitations`) | `Limitations` | `reportFigures` | none | none | Content | Styling |
| 10 | Future work (`future`) | `FutureWork` | static | none | none | Content | Styling |
| — | Nav / Footer / BackToTop / Bridge | `Nav.tsx`, `Footer.tsx`, `Bridge.tsx` | `links.ts` | Mobile menu (Escape returns focus), current-section marker, `is-dark` toggle | Scroll spy | Menu accessibility | `is-dark` switching |

The fixed concept's 02 Repository Anatomy **has no section today**. Sections 05–10 together map to
05 Research Evidence.

## 4. Verified research data

I re-derived these figures from `site/data/results.json` with a script. The file is byte-identical to `public/data/results.json`; all 77
`tasks/*.json` files equal their entries; `summary.json` arms and trust equal the source.

| Claim | Verified | Detail |
|---|---|---|
| 77 tasks | ✓ | 39 `test` + 38 `fresh` |
| 6 conditions | ✓ | `none, prose, sensors, both, handwritten, tuned` |
| 2 repeats per task × condition | ✓ | every `results[arm].runs` has length 2; `solved` equals the sum of `resolved` |
| 924 runs | ✓ | `summary.runs` = 924 and the counted runs = 924 |
| 43 always / 23 mixed / 11 never | ✓ | recomputed from runs; matches `summary.json` `group` |
| Arm rates | ✓ | none 112/154 (72.7%), prose 112, sensors 111, both 111, handwritten 107, tuned 113 (73.4%) |
| Paired difference vs none and 95% CI | ✓ (in `arms[]`) | prose 0.0 [−5.8, +4.5], sensors −0.6 [−6.5, +4.5], both −0.6 [−7.1, +5.8], handwritten −3.2 [−9.1, +1.3], tuned +0.6 [−2.6, +4.5] points |
| Per-arm rate CIs, detectable effect (5.4–9.1), web tiers, robustness, hook delivery, failure rules | **not in JSON** | hand-copied from `reports/main.md` into `src/data/reportFigures.ts` |
| Total cost | ✓ | `summary.total_cost_usd` = 21.31 |

**WINDOW task**: `tobymao__sqlglot-fresh-63296846` ("Sqlite ParseError … for WINDOW"), `FEATURED_TASK`.

| Condition | Repeat 1 | Repeat 2 | Hook messages |
|---|---|---|---|
| none | ✗ | ✗ | — |
| prose | ✗ | ✗ | — |
| sensors | ✗ | ✗ | co-change parser.py → generator.py, expressions.py (both runs) |
| both | ✓ | ✓ | co-change (both); ruff format (repeat 2) |
| handwritten | ✓ | ✗ | — |
| tuned | ✗ | ✓ | ruff format + tuned follow-up (repeat 2) |

That is 12 runs and 4 solved.
- The three approaches (7 shortcut, 4 look-ahead, 1 other) are **not exported data**. They are a
  hand classification per run in `reportFigures.ts FEATURED_APPROACHES`, sourced from README/PHASE_LOG.
  `tests/unit/data.test.ts` re-derives the shortcut and other runs from the diffs.
- The failing alias query and the pytest log are cited but not published.

**Run-level fields**: `seed`, `resolved`, `cost_usd`, `diff` (923 of 924 non-empty, capped at 30k
chars and scrubbed), `hooks` (delivered messages only; 217 runs have at least one).

## 5. Available 3D and repository artifacts

| Artifact | Status |
|---|---|
| Current scenes (`RunLattice`, `Workbench`), `palette.ts`, `shaders/noise.ts`, `random.ts`, `layout.ts` | present |
| SignalField, ExperimentStreams, MatrixSurface, PipelineEngine, SceneControls, HeroHotspots | deleted in the working tree; recoverable from `09549a9` |
| Nebula poster `public/assets/signal-field-fallback.jpg` and `scripts/capture-poster.mjs` | deleted; recoverable from `09549a9` |
| Repo / filesystem / commit-graph scene | **not found in any version** |
| `.uplift/<repo>/risk.json` (co-change rules, test map, risk scores) | **not on disk** |
| `tasks.jsonl`, `split.json`, generator runs, generated arm files (AGENTS.md, hooks.json, MANIFEST) | **not on disk** |
| `runs/<arm>/<task>-s<seed>/` (patch, prompt, hooks.jsonl, traces, pytest log) | **not on disk** |
| Workspaces, parquet cache, budget ledger (`tools/budget_guard/meta/`) | **not on disk** |
| A sqlglot clone (source files, commit history) | **not on disk** |
| `arms/handwritten/AGENTS.md` | present |
| `reports/main.md` + 4 PNGs | present |

`.uplift/`, `runs/`, `workspaces/`, `meta/`, `data/cache/` are gitignored, so the artifacts were never
committed and do not exist in this checkout. I have not inferred their contents.

## 6. Data export gaps

| Concept | Needs | Available now | Gap |
|---|---|---|---|
| 01 Nebula (77-bug atlas) | per-task id, set, group, per-arm solved, title | all in `summary.json` | **none**. Extra dimensions (files touched, risk score, date) are not exported |
| 02 Repository Anatomy | real source files, commit relationships, co-change rules, source→test map | only co-change pairs quoted inside hook message strings, and file paths inside diffs | **blocking**. Needs an owner-approved export (e.g. a public subset of `risk.json` plus a file list at the snapshot commit), produced by the pipeline from the real artifacts |
| 03 Experiment Bench | tasks, conditions, repeats, per-run outcome, dev/test split, tune branch | yes, except the dev task list: the 40 dev tiles are hard-coded and the dev tasks are not exported | dev task ids/outcomes (optional) |
| 04 WINDOW | 12 runs, diffs, hooks, approach labels | runs, diffs and hooks exported; approach labels hand-coded in TS | the approach labels could move into an export; the pytest log is not published |
| 05 Evidence | rates, paired CIs, matrix, explorer, integrity, limitations | JSON + `reportFigures.ts` | report-only figures are hand-copied (drift risk); no generated `report.json` |

## 7. Existing motion implementation

- **GSAP/ScrollTrigger** is a dependency, and `hooks/useGsap.ts` correctly reverts its context on
  unmount. But no component uses `useGsap` or `scrollTrigger` any more. `scheduleRefresh`
  (`App.tsx`) refreshes zero triggers and is dead code.
- **Scroll coupling** is a plain scroll listener (HeroStage) and a rect check (Methodology). Neither is pinned.
- **Entrance motion**: the IntervalChart draws in from zero via `useInView` (skipped for reduced
  motion); the RunLattice build-in and colour sweep; the Workbench barrier dim.
- **Reduced motion**: `sceneStore.ts:45` reads `prefers-reduced-motion`, and `app.css:161` has a
  reduce block. RunLattice starts on Outcomes with no build-in. An e2e test covers this.
- **Lifecycle defects**:
  - `ExperienceCanvas` runs frameloop `always` while the static Workbench is visible.
  - Its `Driver` still writes `live.time` and pointer values that nothing reads.
  - The `useNear` retry `setTimeout(attach, 400)` and a scroll `requestAnimationFrame` are never cleared (`ExperienceCanvas.tsx:33, :113`).
  - `WorkbenchScene` allocates `new Matrix4()` every frame (`:169`).
  - `RunLattice` invalidates on every pointermove and scroll even when offscreen (`:115-121`), and rewrites all 924 matrices per rendered frame (`:187-212`).
- Every scene's scroll and resize listeners are removed on unmount. No `setInterval` loops exist.

## 8. Performance and accessibility baseline

- **Bundle** (`vite build`): `react-three-fiber` chunk 918.6 KB (242.7 KB gzip), `index` 466.0 KB
  (152.2 KB gzip), `ExperienceCanvas` 97.2 KB, `markdown` 76.6 KB, `RunLattice` 5.9 KB, CSS 78.2 KB
  (16.5 KB gzip), plus 12 Geist woff2 subsets. three/R3F now load for the hero (after first paint),
  no longer only near the method section.
- **WebGL contexts: 2** (RunLattice + ExperienceCanvas). That breaks the one-canvas rule and doubles GPU
  context cost on mobile.
- No fresh Lighthouse or FPS measurements were taken in this audit. `scripts/qa/fps.mjs` exists.
  The last recorded figures are in `BUILD_LOG.md` M10 (Lighthouse accessibility 94 → after the
  muted-text fix).
- **Accessibility present**:
  - skip link, keyboard-navigable matrix and chart, DOM buttons over 3D labels.
  - Escape-closable menu that returns focus.
  - `aria-hidden` canvas, no-WebGL fallbacks for both scenes.
  - a reduced-motion path, ✓/✗ glyphs alongside colour.
  - an e2e test for no horizontal overflow at phone and tablet widths.
- **Gaps**:
  - e2e runs only the desktop project, at 1440×900 (mobile checks are viewport resizes inside it).
  - The Workbench 3D view is hidden on narrow screens by design.
  - The `#77716b` contrast issue is recorded in the identity audit.

## 9. Test baseline (unchanged tree)

| Suite | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | ✓ exit 0 |
| Unit (vitest) | `npx vitest run` | ✓ 5 files, **36/36** |
| Build | `npx vite build --outDir <scratch>` | ✓ |
| E2E (Playwright, desktop, hardware GL) | `npx playwright test` against `vite preview --base /uplift/` of the scratch build | ✓ **22/22** (55.9 s) |
| Python | `python -m pytest` | **not run**: pytest is not installed for the system Python 3.14, and there is no venv or uv. 15 test modules exist in `tests/` |

To run these in Git Bash, set `MSYS_NO_PATHCONV=1`, or `--base /uplift/` is rewritten into a Windows path.
`site/dist` (02:11) predates the latest source edits. `npm run e2e` would serve it unless rebuilt.

## 10. Risks to the redesign

1. **Uncommitted work.** 42 tracked files are modified or deleted and 27 new source/test/QA files are
   untracked. Phases 1–5 of BUILD_LOG exist only in the working tree.
2. **Secret exposure.** `.credentials.json` sits at the repo root, untracked and **not gitignored**.
3. **Repository Anatomy has no real data.** Building it now would require fabricated files and
   commits, which the direction forbids. It needs an owner decision and a pipeline export first.
4. **The one-canvas rule is already broken** (RunLattice). Merging it into `ExperienceCanvas`
   touches the hero, its fallback and the e2e WebGL tests.
5. **Three colour systems and two type scales** (identity audit). A token change touches all six
   stylesheets and ~30 hex literals in the scenes.
6. **Hand-copied figures** in `reportFigures.ts`, `method.ts` and the `types.ts` contracts can drift
   from `reports/main.md` and `analysis.export`. They are guarded only by unit tests.
7. **The hard-coded WINDOW approach labels** must stay aligned with the diffs (unit-tested).
8. **Re-introducing ScrollTrigger pins** (as in `09549a9`) needs `useGsap` context cleanup, a
   `scheduleRefresh` after data and fonts load, and pins disabled for reduced motion and narrow screens. The
   old code had all three, so reuse it.
9. **Stale docs.** `UPLIFT_CONTEXT_REPORT.md` describes deleted scenes and an "≈690-line app.css".
   `BRIEF.md` still asks for light and dark mode. Treat both as historical.
10. **Python tests cannot currently run** here, so a pipeline export for Repository Anatomy would ship
    without a local test pass until pytest is installed.

---

## Recommended implementation order (safest first)

0. **Safeguard** (owner action, or with approval): commit or branch the current working tree; add
   `.credentials.json` to `.gitignore`.
1. **Tokens and theme consolidation.** Apply the approved dark tokens and remove the `.pub` / `.pub--dark` /
   `.nav.is-dark` / `--p-*` / `--d-*` layers. Visual only, no behaviour change. The full e2e suite guards it.
2. **Canvas and lifecycle hygiene.**
   - Move RunLattice into the shared `ExperienceCanvas` with visibility gating.
   - Use frameloop `demand` for static scenes; remove the dead Driver writes and the per-frame allocations.
   - Clear the leaked timeout and rAF; remove or reuse `scheduleRefresh`.
3. **01 Nebula atlas.** Restore SignalField from `09549a9` as the visual base and bind its points to
   the 77 tasks from `summary.json`. Keep the SVG/static fallback and DOM-button accessibility.
4. **03 Experiment Bench.** Restyle and extend the existing `WorkbenchScene` + `Inspector` (the data
   wiring is done); add choreography with the old `useGsap` pin pattern.
5. **04 WINDOW investigation.** Restyle `WorkedExample` on the existing data and approach labels.
6. **05 Research evidence.** Restyle Results, Matrix, Explorer, Trust and Limitations without changing
   chart semantics or the sanitisation path.
7. **02 Repository Anatomy, last.** Only after the owner approves a real data export from the pipeline
   (co-change rules, the test map and the file/commit list at the snapshot). Until then, do not build it.

Each step: build → unit → e2e → visual inspection → report → stop.
