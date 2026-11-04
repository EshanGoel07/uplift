# Experiment Atlas execution log

Plan: M0 to M13. The run stopped at the usage limit, so this is a partial build. Nothing was pushed or deployed.

## Done (local commits on `redesign/experiment-atlas`)
- **M0** Phase 01 to 02.1 base committed.
- **M1, M2** Shared selection with URL sync, header, progress line, Task Passport, Run Inspector, comparison tray, Ctrl/Cmd+K search, Explore/Investigate, evidence data.
- **M3** Nebula Atlas from the original Signal Field, with lenses, dock and guide. Phones get a 2D atlas with no WebGL.
- **M4** Lattice isolation by bug, condition and repeat, through uniforms.
- **M5** Findings: sensitivity views from the report, zero-line and detectable-range explanations, two-condition reading, summary strip.
- **M6** Conditions control room and paired explorer. `scripts/build_atlas.py` generates `public/data/architecture.json` and `public/data/source/`.
- **M7** Apparatus: eight presets, clipping to the stage, Muse Code module, exploded workspace by condition, barrier cross-section.

## Not done
- **M8** WINDOW: approach selector, two-run side-by-side view, focus mode, issue-to-fix trace.
- **M9** Bug Atlas: Matrix/Task list/Lattice switch, sort, density, URL state.
- **M10** `#architecture` section, topology map, lineage ribbon. The data exists; the section does not, so the header's Architecture link goes nowhere yet.
- **M11** Integrity timeline work, placing `EvidenceLedger` on the page, FAQ, site-wide guided tour. The palette's tour action has no tour to start yet.
- **M12** Full QA at all widths, performance re-measurement of the Nebula (`sweep.mjs` assumes the old hero), research-number audit.
- **M13** Final report, push, preview, production deploy.

## Test state at this commit
TypeScript and 103 unit tests pass. The last full Playwright run was before M4 (42 of 45, with the three failures then fixed in the tests). After M7, a targeted set of 7 e2e tests passed. The full suite has not been run on this commit.

## Recorded decisions
- Push target is the branch, not `main`, because the repo is shared.
- `lucide` is not a dependency, so a small inline icon set is used.
- The original master prompt and reference recordings were not available.
- Scene mini-map was deferred as P2. The cross-section is a DOM panel plus a stronger 3D wall, not a true geometric cutaway.
