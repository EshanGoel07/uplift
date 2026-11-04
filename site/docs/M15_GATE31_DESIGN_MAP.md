# Uplift Gate 3.1: Spatial Model Redesign (design map and plan)

## Context
The owner rejected the look of the three Gate 3 models. The Workspace reads as stacked plates and a cylinder, the Cutaway's two platforms and wall teach the wrong idea (the separation is timing, not space), and the Grader is nine identical gates. Controls crowd every stage. This gate adds no functionality: the three models must carry their meaning through geometry, motion and interaction.

Gate 3 commits are the functional baseline. Work only on `redesign/site-next`. No push, force-push, history rewrite, `main` change or deploy. Stop afterwards and wait for visual approval before M15.11.

## What the source established
- **Grading order is verified.** `GRADING_STEPS` matches the code:
  1. `infra_failure` (`runner.py:231`, patch already recorded at `:225`)
  2. `reset_test_files` (`grade.py:174`)
  3. `git apply` hidden tests (`:175`)
  4. `clear_bytecode` (`:143`, inside `run_tests`)
  5. pytest (`:147-152`)
  6. `parse_pytest` (`:158`), then the raw log is saved (`:179-181`)
  7. `check_output` (`:182`)
  8. FAIL_TO_PASS and PASS_TO_PASS (`:186-188`)
  9. `screen.resolved` (`runner.py:242`, `screen.py:245`)
  
  The owner's example list had eight; the ninth is step 1. The log save has no step of its own, so it goes in step 6's text. Failure exits are at steps 1, 3 and 7.
- **Real material for the geometry**, so nothing is invented:
  - The WINDOW bug (`public/data/tasks/tobymao__sqlglot-fresh-63296846.json`): the real 15-line issue, and per-condition real diffs, outcomes and hook messages.
  - The real fix commit `63296846`, parent `7e7cf8b` (readable through `gh api`), touching `sqlglot/parser.py` and `tests/test_parser.py`.
  - AGENTS.md line counts: 13, 60 and 11.
  - Hooks: `PostToolUse` runs lint and co-change, `Stop` runs verify; tuned drops co-change (`generate.py:40-41,254-257`, `method.ts`).
  - 40 model steps, 2,400 s, 900 s.
- **Not published, so it stays schematic and says so:**
  - Per-test F2P and P2P lists and counts. The Grader's test cells are illustrative, disclosed on the stage.
  - Generated AGENTS.md contents. Strokes show the real line count only, and the inspector says the contents are not published.
  - Hook config contents. Only the event and check structure and the real delivered messages are shown.
- **Copy to correct.** `method.ts:37` says the agent "never saw" the hidden tests. The audit found 80 runs that saw the fix or newer code on the web, so it becomes "was never in the agent's workspace". Cutaway Phase A says "not in the workspace" and carries `NETWORK_NOTE`. This keeps "the hidden tests remain inaccessible" accurate to the 924 runs; flag it to the owner.

## Shared spatial language
- **One new material**, `graphiteMaterial` in `src/scenes/materials/shared.ts`. Graphite body lit by one warm point source at the model's centre (`uCoreP`, `uWarm`), a cool spectral rim (`uCool`), luminous inks from a per-vertex `aInk`, and a per-vertex `aSeq` against `uReveal` so strokes and cells light in sequence. Keeps `uFade`, `uDim`, `uSelect` (fine Ember only). One shared program, no bloom, no glass.
- **Geometry kit**, `src/scenes/Assembly/forms.ts` (new): pure builders returning merged body plus edge geometry, using `mergeGeometries` as `CohortScene` already does. Forms: `repo`, `doc`, `ticket`, `hookGraph`, `core`, `diff`, `testSheet`, `cells`, `tape`, `tally`, `seal`, `room`, `rail`. No text textures; strokes stay crisp and no new dependency is needed.
- **Data model extension** (`src/state/assemblyStore.ts`): `Part.form`, `PartPose.reveal`, `.scale`, `.rot`, per-state `light {warm, cool}`, `Part.focus`, and a step's `parts` and `controls`. `AssemblyScene` keeps targets, demand rendering, the registry, the `StageView` lifecycle and `settledAt`. Everything stays target-eased, with no timelines.
- **Selection, all models:** the part gains Ember edges and eases forward; others recede to `uDim` 0.35 and lose saturation; the camera eases to `Part.focus` (derived from pose and size by default); the inspector shows role and source. Reader drag still applies.
- **Models hold every possible part**, with `on: 0` where absent, so a condition change fades artifacts in and out without remounting.

## Model 1: Workspace (layered, artifact-oriented)
**Composition:** a closed block that opens along one tilted axis, with a fine spectral spine through it.

| Object | Geometry |
|---|---|
| Repository | Extruded treemap plinth of the real sqlglot tree at `7e7cf8b`, grouped by directory, footprint by file size. Committed as `src/data/repoTree.json` by `scripts/build-repo-tree.mjs` |
| History removed | One commit ring with a severed chain stub |
| Agent files removed | Dashed ghost outline of a sheet |
| Issue | Ticket with notched header and 15 real-length strokes |
| AGENTS.md | Portrait sheet with folded corner and heading mark; strokes equal the real line count (absent in No setup and Hooks) |
| Hooks | Two event pucks joined by filaments to check capsules; tuned has no co-change capsule |
| Muse Code | Warm core inside two rings; one carries 40 ticks for the step limit |
| Patch | Diff slab with gutter; strokes taken from the selected condition's real diff, lengths from real lines, green or red from `+` or `-`. The real changed files light on the treemap |

**Steps (6):** `assembled` → `exploded` → `issue` → `setup` (condition picker shown here only) → `running` (reassembles, core ignites) → `patch`.

**Condition:** read and written through `atlas` (`s.condition ?? 'both'`, the existing `cond` URL param), as `Methodology` already does, so the Cutaway follows it.

**Cameras:** high three-quarter when assembled, lower and longer along the axis when exploded, close per object.

## Model 2: Cutaway (architectural, temporal)
**Composition:** one section-cut room, never two sides, and no wall. Same objects and forms as Model 1, in fixed positions for every state. Under it, a time rail with ticks: start, agent exits, tests applied, grading, result, and an Ember playhead.

**The key idea:** hidden tests sit as a sealed block on the rail at their future tick. They are not behind anything; they are later. The room labels nothing as a chamber, and no invented infrastructure appears.

**Steps (6):**
- `received`
- `working` (Phase A, warm core-lit room, filaments to the artifacts)
- `exit` (core dims, rings stop, light falls, patch recorded in place)
- `hidden` (Phase B, cool light; playhead reaches the block, which rises into the same workspace onto `tests/test_parser.py`)
- `grading` (scan passes over the same repository, links to the next section)
- `result` (real outcome for the selected condition's first repeat of the WINDOW bug)

**Stage caption:** one plain line, "Phase A · Agent working" or "Phase B · Agent has exited". The condition has no picker here and is named in the text.

## Model 3: Grader (computational, procedural; a 2D/3D hybrid)
**Composition:** one persistent instrument bench, with the workspace as its subject. The camera moves between zones, and everything stays in the scene. Illustrative cells are disclosed on the stage.

| # | Step | Distinct treatment |
|---|---|---|
| 1 | Check the run finished | Run record capsule; a status ring closes and the bench unlocks |
| 2 | Reset the test files | Test sheets; a sweep line wipes agent edits back to base |
| 3 | Apply the hidden tests | A new sheet descends and its hunks register onto the stack |
| 4 | Clear stale bytecode | Field of small cubes dissolves; the `.venv` enclosure stays intact |
| 5 | Run pytest | Scan line crosses the cell matrix row by row; a ring marks the 900 s limit |
| 6 | Parse each test | Output tape; each line ties by filament to a cell, which takes its outcome |
| 7 | Cross-check the counts | Parsed bars and summary bars meet on a shared baseline, ticks aligned |
| 8 | Check both test lists | The matrix splits into F2P and P2P trays |
| 9 | Record the verdict | Excluded cells step aside as hollow outlines; a seal closes |

**Step card:** a one-line explanation, then "Before" and "After", then "If this fails" for steps 1, 3 and 7. A `Source` disclosure shows `file:line` and the real lines, fetched from `public/data/source/` (`sourcePath` in `src/sections/Architecture/types.ts`), with a repository link. Add `source {file, start, end, anchor}`, `before`, `after`, `fails` to `GRADING_STEPS` in `src/data/method.ts`, keeping titles and state names.

## Vertical presentation
`assembly__inspect` is rebuilt. The always-on chip rows go. Each step declares its 1–3 relevant objects, shown as one quiet text row low on the left of the stage, with one inspector panel above it. The condition picker appears only on `setup`. "Reset view" appears only when the view has changed. Full-part keyboard access stays through a visually hidden list that shows on focus.

## Responsive
Phones and no-WebGL get designed SVG alternatives in place of the current generic rectangles. `AssemblyFigure` draws a small glyph per form at an authored per-state layout: exploded artifact column, timeline with Phase A and B, and per-step instrument glyph with text and source. The 3D stage and all behaviour stay desktop-only as today.

## Order of work
1. Capture all current states to `qa-screenshots/m15/g31/before/`, and write this map to `site/docs/M15_GATE31_DESIGN_MAP.md`.
2. Shared kit (material, forms, store, scene, inspector) with the old models still passing.
3. Workspace: build, inspect at close range by eye, iterate, tests, commit.
4. Cutaway: same.
5. Grader: same.
6. Responsive alternatives and final review.
7. First-hover: a separate investigation. Report the evidence; fix only if the cause is proven and isolated.

**Commits:** one `Gate 3.1: ...` commit per model, on top of `63edea7`, as an owner-visible deviation from the brief's single "separate local commit". Attribution rules stay as stored: no Claude lines.

**Files changing:** `src/scenes/materials/shared.ts`, `src/state/assemblyStore.ts`, `src/scenes/Assembly/AssemblyScene.tsx`, `src/data/models.ts`, `src/data/gradingModel.ts`, `src/data/method.ts`, `src/sections/Story/{AssemblyStory,AssemblyFigure,WorkspaceStory,CutawayStory,GradingStory}.tsx`, `src/styles/story.css`, `tests/unit/models.test.ts`, `tests/e2e/models.spec.ts`. Lazy loading stays: `forms.ts` lives in the scene chunk, and the WINDOW task file loads through `loadTask` only near a model, with neutral strokes if it fails.

## Verification
All sequential, because of memory. `npm run typecheck`, `npm test`, `npm run build`, then e2e one suite at a time, on both production and the dev server.

**New unit invariants:**
- Each condition shows exactly its real artifacts, with real line counts and hook checks.
- Every Cutaway workspace part has the same position in every state.
- No hidden-test part is inside the room before `hidden`, and the agent is inactive by then.
- There is no wall or barrier part.
- Every grading source anchor is found at its stated line, in both the repo file and the site copy, and call order ascends.
- Patch strokes equal the real diff's lines.

**New e2e, closing Gate 3 gaps:** real pixels in every state at 1440×900 and 1920×1080, rapid selection during scrolling and condition changes, drag rotation, reduced motion, failed chunk fallback, no-WebGL on all three, one Canvas only, selected object focuses and others recede, source disclosure shows real code. Extend `scripts/qa/m15-reliability.mjs` to cover the models (20 cold loads, 10 cycles) on dev and production. Rerun Lattice, Nebula, One Bug, navigation, URL and comparison suites to prove nothing regressed.

**Performance:** `m15-early-hover.mjs`, `m15-startup-profile.mjs`, shader compile timing, bundle sizes, and frame time during transitions, against the Gate 3 figures.

## Deliverables at stop
- Screenshots in `qa-screenshots/m15/g31/`, at 1440×900 and 1920×1080:
  - Workspace: assembled, exploded, each object inspected, condition change, reassembly
  - Cutaway: agent working, agent exit, hidden tests introduced, grading begins
  - Grader: initial, all nine steps, source inspection, final verdict
  - Mobile alternatives
- One real interaction recording per model through Playwright `recordVideo` (webm, no new dependency).
- Before/after sheets, design map, test results, performance measurements, remaining defects.

## Risks
- The bar is visual, and the previous attempt failed it. Review every form close up before moving on, and report honestly if a form still reads weakly.
- A merged treemap and ink shader could add compile or frame cost. Measure after Model 1, and simplify the geometry if needed.
- Memory pressure can stop runs. Stop cleanly and say so.
- Hidden-test wording deliberately differs from "inaccessible" for accuracy.
