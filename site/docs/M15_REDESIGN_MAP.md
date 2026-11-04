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

## First-hover baseline
Probe: `scripts/qa/m15-firsthover.mjs`, fresh page each trial, 1440×900, 8 s settle, Iris Xe.

| Build | Trials | Median | p95 | Worst | Frames over 50 ms | Long tasks |
|---|---|---:|---:|---:|---:|---:|
| Baseline, readout shown | 6 | 16.7 | 16.8 | 16.8 | 0 | 0 |
| Baseline, readout hidden | 6 | 16.7 | 16.7 | 33.2 | 0 | 0 |
| New Lattice, readout shown | 3 | 16.7 | 16.8 | 16.8 | 0 | 0 |
| New Lattice, readout hidden | 3 | 16.7 | 16.7 | 16.8 | 0 | 0 |

**The stall did not reproduce under this probe, on either build. It is not established as fixed.** The earlier reports used different timing, and this probe waits 8 s before first contact. M15.9 must retest with earlier contact and with a trace.
