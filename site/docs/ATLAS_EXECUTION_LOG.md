# Experiment Atlas execution log

Plan: M0 to M13. All milestones ran. The items under "Cut or partial" were not built as the vision described them.

## Shipped (commits on `redesign/experiment-atlas`)
- **M0** Phase 01 to 02.1 base committed.
- **M1, M2** Shared selection with URL sync, header, progress line, Task Passport, Run Inspector, comparison tray, Ctrl/Cmd+K search, Explore/Investigate, evidence data.
- **M3** Nebula Atlas from the original Signal Field, with lenses, dock and guide. Phones get a 2D atlas with no WebGL.
- **M4** Lattice isolation by bug, condition and repeat, through uniforms.
- **M5** Findings: sensitivity views from the report, zero-line and detectable-range explanations, two-condition reading, summary strip.
- **M6** Conditions control room and paired explorer. `scripts/build_atlas.py` generates `public/data/architecture.json` and `public/data/source/`.
- **M7** Apparatus: eight presets, clipping to the stage, Muse Code module, exploded workspace by condition, barrier cross-section.
- **M8** WINDOW investigation: issue-to-outcome trace, approach selector, two-run side-by-side, reading mode.
- **M9** Bug Atlas: Matrix / Task list / Lattice over one filtered set, sort, condition filter, density, filters in the URL.
- **M10** `#architecture`: data lineage ribbon, source explorer (file list, search, definitions with line jumps, real source), module map with three lenses, research topology in four modes.
- **M11** Integrity: network policy table, Evidence and Provenance Ledger, evidence badges. FAQ in Limitations. Guided tour (skippable, never locks scrolling).
- **M12** QA, below.

## Defects found and fixed in QA
- Header items overlapped at 1920 px and below, because seven links no longer fit the page column. The header now spans the window and the menu takes over at 1240 px. Tests cover 1241 to 2560 px.
- Section jumps could land up to 390 px off (the correction ran during the smooth scroll). `jumpTo` now waits for the scroll to stop, and yields to a newer jump or the reader's own input.
- Apparatus labels collided at 1024 px. Each label is now lifted clear of those already placed. Tests cover 1024, 1280, 1440 px.
- The Conditions section fetched a task file on first paint. It now waits until it is near the viewport.
- The evidence ledger was crushed at 768 px. Below 900 px it stacks.
- One intermittent e2e failure was a test race on the lazily loaded Workbench chunk; the test now waits for the mount.

## Measurements
- Lattice hover, 10 sweeps at 1440 x 900 on Iris Xe: steady state p95 16.8 ms, worst 16.8 ms in sweeps 2 to 10.
- Nebula hover, 6 sweeps: p95 16.8 ms, p99 16.8 ms. Zero idle frames once its drift ends.
- Page overflow and console errors: none at 375, 390, 600, 768, 1024, 1440, 1920.

## Known issue: first-hover stall
On a fresh page, the first contact with the hero stalls for 300 to 500 ms, once to three times, then stops. Up to about 12 stalls were seen in one comparison run. Trace: `RendererRasterWorker` `CommandBuffer::Flush` in the GPU process, so it is DOM raster, not WebGL. Hiding the readout nearly removes it. The cause is unresolved.

This is **not** an Atlas regression: the same probe reproduces it on `924a4f1`, `fc26d32` and `872829b`. It also means the Phase 02.1 report's "0 frames over 50 ms" does not hold for the first sweep of a fresh page under this probe. Debouncing the readout by 160 ms reduced it (now 2 stalls of 100 to 380 ms) and did not remove it. Strictly, the plan's "nothing over 50 ms" gate is not met.

## Cut or partial
- Scene mini-map and source-code minimap: not built. P2.
- Barrier cross-section is a DOM panel plus a stronger 3D wall, not a true geometric cutaway.
- Module map is not on phones; the file list and source view are.
- Reduced GSAP editorial reveals: not added. `useGsap` stays unused, so GSAP is tree-shaken.
- The Lattice view in the Bug Atlas shows solved counts per condition. The order within a pair is not meaningful there, which the caption states.

## Recorded decisions
- Push target is the branch, not `main`, because the repo is shared.
- `lucide` is not a dependency, so a small inline icon set is used.
- The original master prompt and reference recordings were not available.
- The vision's hero conclusion wording, "No setup was shown to differ from no setup", was kept.
