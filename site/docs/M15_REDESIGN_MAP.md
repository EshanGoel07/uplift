# M15 redesign map

Evidence gathered before the redesign (M15.0), on `redesign/site-next`. Baseline captures are in `qa-screenshots/m15/before/` (gitignored). Regenerate them with `scripts/qa/m15-shots.mjs`.

## Git state at start
Branch `redesign/site-next`, created from the rewritten `redesign/experiment-atlas` tip `b9d434f`. Working tree clean apart from the reference recording, now ignored by git and Vercel. Production stays on `redesign/experiment-atlas` until the owner decides otherwise.

## Changes to the brief, from the source
- **Grading happens in the agent's live workspace** (`src/uplift/runner.py:240`). The patch is not the only thing that reaches the evaluator. The boundary is timing: hidden tests arrive only after the agent exits. The cutaway must be labelled a conceptual information barrier.
- **Grading steps.** Per-test `-rA` lines are parsed and pytest's summary is the cross-check, not the reverse. Only `__pycache__` is deleted. Whole test files run. Runs with `infra_failure` never reach grading. The recorded verdict is `screen.resolved`, which ignores screened-out F2P tests.
- **Site copy to correct:** `method.ts:29`, `method.ts:36`, `method.ts:63`, and the screening-before-split order in `lineage.ts` (confirm against `cli.py` first).
- **Pipeline:** the five stages are honest, but not linear. `tune` consumes stage 4 dev results.

All research figures in Part 01 of the brief were confirmed against `reports/` and `public/data/`.

## Information hierarchy
| Destination | Question | Sections in order |
|---|---|---|
| Overview | What is Uplift? | `overview` |
| How it works | What did they do? | One bug to 924, `conditions`, workspace, agent/evaluator, grading, `method` as optional full apparatus |
| Findings | What happened? | `results` |
| Explore bugs | Can I inspect the data? | `explorer` (WINDOW), `matrix`, `explorer-all` |
| Research details | How was it built, and how reliable is it? | `architecture`, `trust`, `built`, `limitations`, `future` |

## Repeated information to remove
| Content | Repeated in |
|---|---|
| 77×6×2=924 | Hero, GuidedTour, Methodology (2), BugMatrix, Results (2), WorkedExample (2) |
| Null finding | Hero and Results verbatim; Results and GuidedTour restate it |
| 5.4 to 9.1 pp | Hero, Results (3), GuidedTour |
| 43/23/11 | BugMatrix (3), TaskPicker, NebulaMap, Limitations |
| Pairing and bootstrap | Results (3), Methodology, BugMatrix |
| Web leak | Trust card and investigation, Limitations, Faq |
| Issue and RunBoard | WorkedExample and BugExplorer |
| Patch diffs | WorkedExample's compare defaults equal `DEFAULT_RUN`, so two render twice |

## Initial-state overload
- **Method:** about 40 controls and labels at once.
- **WorkedExample:** task card, trace, 12-run board, approach filter and panels, compare, and five diffs.
- **BugMatrix:** two control rows, legend and a 462-cell grid before any explanation.
- **BugExplorer:** a 77-item picker, issue, 12-run board and an open run with its diff.

## Interaction inventory
Keep: shared selection and URL state (`task`, `cond`, `rep`, `panel`, `cmp`, `view`, `hero`), Task Passport, Run Inspector, comparison tray, Ctrl/Cmd+K, Explore/Investigate, tour, Nebula lenses and dock, Lattice isolation, Workbench presets, Matrix/Task list/Lattice, source explorer, evidence ledger.

Fix: `jumpTo` uses `replaceState`, so section moves create no history entry. There is no hash handling on load. BugMatrix params are not restored on Back. `jumpTo` fails silently on an unmounted id.

## Composition decisions
| Experience | Relationship | Composition | Why |
|---|---|---|---|
| Overview | Single answer | Full-bleed Nebula | One object, one question |
| One bug to 924 | Sequential | Sticky stage beside steps | The object persists while the design grows |
| Six-way comparison | Parallel | Horizontal, on request | A true comparison, after the story explains it |
| Workspace | Hierarchical | Full-width scene or sticky stage, chosen from captures | Layers need room |
| Agent/evaluator, grading | Sequential | Full-width scene, then compact instrument | Two spaces, then one precise sequence |
| Findings | Quantitative | Full-width 2D chart with editorial steps | Precision over spectacle |
| WINDOW | Forensic sequence | Sticky code/attempt workspace beside steps | Evidence stays in view as the argument moves |
| Bug Atlas | Exploratory | Master-detail, Task list first | Matrix is an advanced instrument |
| Source | Pipeline, then graph | Sticky pipeline beside steps; graph as neighbourhood view | Understanding before detail |
| Phones | n/a | Unpinned, 2D first, no WebGL for stories | A designed alternative |

## Reference recording
`Screen Recording 2026-11-03 222544.mp4` is the OpenSec reference: 109 s. Worth learning from: a trace that pairs a file tree with code, a ranked list beside an evidence and patch panel, and a single highlighted path through a dimmed map. Its palette, branding and components are not to be copied.

## Lattice archaeology
| Version | Form | Lost or gained |
|---|---|---|
| `c7bb566` MatrixSurface | Curved additive sheet with bloom, 462 tiles | Strongest grid form; spectral colours meant outcome, which the brief now forbids |
| `33faec9` first RunLattice | Two flat plates of 924 cubes, saturated outcomes | Clear grouping, lost the curve and emission |
| `3e5b16a` onward | Same, paler colours, warm rim | Lost contrast; reads as a tilted spreadsheet |

Decision: one curved additive sheet holding all 924 runs, with green and red for outcome and each condition as one fine filament. Mixed bugs burn brighter than bugs whose twelve runs all agree. The two-group split from RunLattice is kept as a gap in the sheet.

## First-hover findings
Probes: `scripts/qa/m15-early-hover.mjs` (cold browser each trial, readout visible, 1440×900, Iris Xe) and `scripts/qa/m15-startup-profile.mjs`. Contact is measured from the moment the stage exists, about 1.0 to 1.4 s after navigation.

An earlier probe here waited 8 s, saw nothing, and missed the stall. **Early contact reproduces it. It is not fixed.**

| Build | Pointer | Contact | Trials with a frame over 50 ms | Worst frame |
|---|---|---:|---:|---:|
| Before M15 (`b9d434f`) | Moving | 0 ms | 4 of 4 | 299.9 ms |
| Before M15 (`b9d434f`) | Still | 0 ms | 4 of 4 | 300.0 ms |
| Final Gate 1 | Moving | 0 ms | 4 of 4 | 249.9 ms |
| Final Gate 1 | Moving | 250 ms | 3 of 4 | 266.7 ms |
| Final Gate 1 | Moving | 500, 1000, 2000 ms | 0 of 12 | 16.8 ms |

The still-pointer control on the final build also stalled, in all 4 trials. So this stall is page startup, not hover: an early pointer only runs into it. These frames coincide with main-thread long tasks, which does not match the earlier raster/GPU account. That account may describe a separate effect; this work neither confirms nor rules it out.

Headed runs were taken on an interim Gate 1 build: 3 of 3 trials stalled at 0 ms contact, worst 516.4 ms, and none at 500 or 1500 ms.

**Startup long tasks, profiled:** about 600 ms at about 250 ms after navigation, from `Nav`'s mount effect, where the scroll-spy's `getBoundingClientRect` forces the first layout of the whole page. This exists before M15. Later tasks of about 240, 115 and 145 ms remain unattributed; they are the ones that land near first contact.

**A regression, found and fixed:** the Lattice's noise-based haze raised shader linking from about 95 to 162 ms, with a final long task of up to 277 ms. Replacing the noise with layered sines removed it (final task about 129 ms, against about 150 ms before M15).

**Next:** deal with the page's first layout in Gate 2, when the sections are restructured (`content-visibility` on off-screen chapters is the candidate), attribute the remaining tasks, and rerun the same probes.

## Lattice hover
`tests/e2e/site.spec.ts` sweeps all 77 columns, 25 points each (1,925 points), and requires the exact bug at every point. It first found 715 misses. Causes fixed: `out` and `move` fire together when crossing tiles, and the old handler compared against a stale store value, clearing hover inside one bug (carried over from the old Lattice); a 0.022 gap between neighbouring rows' pointer targets; and tiles overlapping too much where the camera angle squeezed columns at the far right. Result: 0 misses.
