# Phase 02: shared 3D engine, WebGL consolidation and scene lifecycle

2026-11-04, branch `redesign/experiment-atlas`, uncommitted, on top of checkpoint `12bbd57` and Phase 01.
No research data, statistics, palette or brand decision changed.

**Headline.** The site now has one WebGL context. At rest, and whenever the scenes are off screen, it draws
nothing. Two costs came with that, and §10 and §12 state them plainly: a short stall when the pointer first
reaches the hero lattice (a regression I reduced but did not eliminate), and about 102 KB more JavaScript at load.

**How the numbers were taken.** `scripts/qa/perf.mjs` wraps `getContext` and the WebGL draw and buffer calls from
outside the app, so the same probe ran unchanged on the Phase 01 build and on this one. Chromium on a desktop GPU
(ANGLE/D3D11), 1440×900. These are one machine's figures, not a mobile measurement.

## 1. Previous architecture

```text
App
├── HeroStage ── lazy RunLattice ── its own <Canvas> (context 1, MSAA)     frameloop demand
└── ExperienceCanvas (mounted near #method) ── shared <Canvas> (context 2) frameloop ALWAYS when visible
      └── Driver, FadeInBloom, WorkbenchScene
```

- Two WebGL contexts on any page that reached the Workbench.
- Visibility was a single value, `live.workbenchVis`, computed by a scroll listener in `Methodology.tsx`.
- `RunLattice` ran a full pass over all 924 instances on every rendered frame, and rendered on every pointer move anywhere on the page, including with the hero off screen.

## 2. New architecture

```text
App ── mounts the canvas when a section first requests a scene
├── HeroStage ───── scenes.request('lattice', stage) + DOM controls + latticeStore
├── Methodology ─── scenes.request('workbench', stage) while the 3D view is shown
└── ExperienceCanvas: the ONE <Canvas> (frameloop 'never' until compiled, then always 'demand')
      priority -1  FrameDriver     wires invalidation, counts frames
      priority  0  scene callbacks RunLatticeScene, WorkbenchScene: do work only if something changed
      priority  1  main pass       bloom composer when the Workbench shows, else a plain render
      priority  2  StageView       lattice: own scene + camera, scissored to its DOM stage
```

| New file | Role |
|---|---|
| `src/scenes/StageView.tsx` | Portal plus scissored pass: draws a scene with its own camera into a DOM rectangle, with one renderer |
| `src/state/latticeStore.ts` | Selection shared by HeroStage (DOM) and the lattice scene |
| `src/scenes/RunLattice/layout.ts`, `types.ts` | Pure, testable layout of all 924 runs |
| `src/hooks/useNear.ts` | `useNear`, extracted and fixed |
| `tests/unit/scenes.test.ts`, `lattice.test.ts` | Registry, cleanup, architecture guards, data integrity |
| `scripts/qa/perf.mjs`, `phase02-shots.mjs` | Build-independent measurement, and review screenshots |

Removed: `scripts/qa/fps.mjs`, which targeted pins that no longer exist; `perf.mjs` replaces it.

## 3. Canvas consolidation

- `RunLattice.tsx` now exports scene content only, and `ExperienceCanvas.tsx` is the only file containing `<Canvas` (a unit test enforces this).
- **Why a scissored view rather than moving the lattice into the shared camera.** The lattice has its own orbiting camera, fitted to its stage with `setViewOffset`. Rendering it as a view keeps that framing unchanged. A portal gives it its own `size` and `camera` through `useThree`, the pattern drei's `View` uses (`node_modules/@react-three/drei/web/View.js`). I wrote a small version instead of using `View` itself, so the render order with the bloom composer stays explicit.
- **"No duplicated camera system":** there is one renderer and one frame loop. The lattice keeps a camera object of its own, because it needs a different view; that is a camera per view, not a second system.
- **Pointer events:** the stage's `events.compute` counts only events whose target is inside the stage element, and otherwise leaves the raycaster without a camera, so R3F skips that scene entirely. Other scenes and DOM controls are unaffected.
- **DOM overlays:** the toolbar, labels, readout, stepper and keyboard behaviour are unchanged. They were already DOM, and they now talk to the scene through `latticeStore`.
- **Scene switching:** the canvas persists. Both are mounted once and never rebuilt (mounts 1, disposals 0 after round trips, asserted in e2e). The canvas is transparent over the obsidian body, so there is nothing to flash. `switch-00…10.png` show the sequence.

## 4. Scene lifecycle changes

The registry lives in `src/state/sceneStore.ts` as `scenes`, so there is no second store.

| Concept | Implementation |
|---|---|
| Identity | `SceneId = 'lattice' \| 'workbench'`, open for future scenes; `SceneName` kept as an alias |
| Available / disposed | no request yet / released after having been mounted |
| Requested | `scenes.request(id, stage, caps)`, which returns `release()` |
| Mounted | `scenes.setMounted(id, bool)`, set by the canvas side |
| Visible | measured from the stage element, as a 0..1 fraction |
| Active / paused | visible; paused when reduced motion applies |
| Animating | `scenes.animate(id)` while busy, `scenes.settle(id)` when done |
| Declared needs | stage element, plus `caps: { reducedMotion, lowTier }` |

There is one scroll/resize listener pair for all scenes. It attaches with the first request and detaches with the
last, and its rAF is throttled and cancelled on detach. `ui.activeScene` and `live.workbenchVis` keep working,
now derived from the registry.

**Removed as dead, with no readers:** `live.time`, `live.pointer`, `rot`, `zoom`, `resetView`, `ui.interact`,
`ui.resetTick`, `pointerWorld`, `pointerState`, and the unused GSAP `scheduleRefresh`.

**Adding a scene:** extend `SceneId`, request it from its section with a stage element, and mount it in
`ExperienceCanvas`, in the default scene or in a `StageView`.

## 5. Rendering-loop changes

- The frameloop is `demand` after compilation; the `always` branch is gone (a unit test enforces this).
- **What causes a frame:** a scroll or resize while a scene is visible; a visibility flip (one clearing frame); a store change; a scene mounting; a scene that is animating.
- **Scroll:** a visible scene is woken inside the scroll event, so its frame lands in the same paint as the page. The stage rect is read inside the frame. Off-screen scenes cost nothing on scroll.
- **Pointer:** the lattice's parallax listener invalidates only while the lattice is visible, and it is not installed at all under reduced motion.
- **Bloom** is enabled only while the Workbench shows, so lattice frames no longer run a full-screen composer pass. Its fade-in is bounded (0.8 s).

## 6. RunLattice optimisation

| Work | Before | After |
|---|---|---|
| Instance matrices | all 924 on every rendered frame | during the bounded build-in only (≈2 s); then only a bug whose lift is changing, 12 instances, through `addUpdateRange`; **none at rest** |
| Instance colours | all 924 on every rendered frame | only while easing, uploading the changed range. The buffer *is* the state array, so there is no per-frame copy |
| Camera fit and label projection | every frame | only when the camera moved or the size changed |
| Positions | recomputed in the frame | `latticeLayout()`, memoised on tasks, arms and orientation |
| Allocations in `useFrame` | closures and tuples per instance | scratch objects; `place()` closes over state only on frames where the camera moved |

Instances stay ordered bug → lane → repeat, so each bug is one contiguous 12-instance block. Build-in and sweeps are
bounded, skipped under reduced motion, and stop while the scene is off screen. Unit tests confirm 924 instances, 77 ×
6 × 2, unique positions, and solved cubes per condition equal to the study totals.

## 7. Workbench optimisation

The `useFrame` audit. `WorkbenchScene` has one callback, and it only runs on rendered frames.

| Step | Reads | Writes | Before | After |
|---|---|---|---|---|
| Fit to stage | stage rect, camera | group transform | every frame, with `new Matrix4()` | only when the rect, aspect or view changes; scratch matrices |
| Barrier dimming | `wb.focus` | material opacity | every frame, `Object.entries` over all materials | only while a side's value changes; flat lists |
| Selected bug | `wb.task`, `wb.runs` | tile colour, lamps, bars | already gated | unchanged |
| Focus highlight | `wb.focus` | lane and edge materials | every frame | only when focus changes |
| DOM labels | model matrix | element transforms | every frame | only on refit |

`FadeInBloom` runs only while enabled and requests frames only during its 0.8 s fade. The experiment wiring and
information-barrier logic are unchanged. Geometry stays shared as module-level `BOX`, `EDGES` and `RING`, one per page and
deliberately not disposed. Materials are created once and disposed by the component that owns them.

## 8. Cleanup fixes

| Item | Fix |
|---|---|
| `useNear` retry | At most one pending; cancelled on unmount; an `alive` guard blocks stale updates (unit tested with fake timers) |
| Scroll rAF | Now a single pending id, cancelled on the last release; many scroll events schedule one measurement |
| Listeners | Stable module-level functions; removed with the same identity (unit tested) |
| Workbench's own scroll/resize listeners | Removed: the registry is the single measurement loop (a source guard enforces it for `scenes/`) |
| GSAP | `useGsap` and its context cleanup are preserved. `scheduleRefresh` and its two `App.tsx` calls, which refreshed zero triggers, are removed |

**Audited, no change needed:** the HeroStage timeout and scroll listener, Nav listeners, `useInView`, `useWidth`, and the `wb`
and `lattice` subscriptions all clean up. The one-shot rAFs in `App` and `BugMatrix` and the 30 ms timer after compile are
fire-once, and `requestFrame` is a no-op once the canvas is gone.

**Other small corrections:**
- **Header:** the background is now solid `--obsidian` and the blur is removed, so content no longer shows through. Measured `rgb(9, 10, 12)` at all five widths.
- **Hover cursor:** now set on the stage element, not `<body>`. It is inherited, so the body write restyled the whole page.

## 9. Test results

Run on the final code, against that code's fresh build in a temporary folder (served bundle `index-Cev3FY-i.js`, matching the build).

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | **8 files, 86 tests passed** (61 before + 25 new) |
| `npx vite build --outDir <scratch>` | built |
| `npx playwright test` | **30 passed**, 0 failed, 0 skipped (22 before + 8 new) |
| Python tests | not run: pytest is not installed here; no Python changed |

**E2E assertions I changed.** Test 21 asserted the old design (`.lattice__canvas canvas` = 1, `.experience canvas` = 0 at the
top of the page). It now asserts the stricter new invariant: exactly one canvas on the whole page, none inside the
stage. Nothing else was removed or weakened.

**New e2e tests:** one renderer across switches (same element, 1 context, mounts 1, disposals 0); rendering stops at rest
at the hero and the Workbench; an animation requests frames and then settles; off-screen scenes ignore the pointer and
scroll; cube hover and click open the right bug; phones never load the Workbench; a WebGL failure falls back with no blank
stage; reduced motion stops rendering at once.

Testing also caught defects of my own, all fixed before this report:
- the lift never settled (a `Float32Array` value compared with a double);
- the last build-in frame stopped short of rest;
- the Workbench mounted after its visibility flip and got no first frame;
- the Workbench request ran before its stage existed;
- "Placing 924 runs…" stayed over the lattice during the build-in.

## 10. Performance comparison (Phase 01 → Phase 02)

**Rendering.** Rendered frames per second / draw calls per second / GPU upload.

| Scenario (3 s sample) | Phase 01 | Phase 02 |
|---|---|---|
| Hero idle | 0 / 0 / 0 | 0 / 0 / 0 |
| Hero, pointer moving | 59.6 / 775 / **4,088 KB/s** | 57.0 / 741 / **63.5 KB/s** |
| Hero off screen, pointer moving | **59.8 / 777 / 4,101 KB/s** | **0 / 0 / 0** |
| Workbench idle | **60.2 / 10,048 / 0** | **0 / 0 / 0** |
| Workbench, pointer moving | **57.9 / 10,417 / 3,969 KB/s** | **0 / 0 / 0** |
| Findings idle, footer idle | 0 / 0 / 0 | 0 / 0 / 0 |

| Question | Phase 01 | Phase 02 |
|---|---|---|
| WebGL contexts at the Workbench | **2** | **1** |
| `<canvas>` elements | 2 | 1 |
| Idle rendering stops at the Workbench | no | yes |
| 924 matrix updates per frame | yes, every rendered frame | no; only during the bounded build-in |
| Heap before → after 5 hero↔Workbench round trips | 16.2 → 12.6 MB | 10.6 → 11.3 MB |
| Context count after switching | 2 | 1, unchanged |

Heap readings in this range move with garbage-collection timing. They show no runaway growth over five round trips, and
that is all they show: they are not evidence of a leak-free engine, and the difference between builds is not meaningful.

**Worst frame during the hero pointer sweep is worse:**

| | Phase 01 | Phase 02 (3 runs on the final hover code) |
|---|---|---|
| Worst frame | 26 ms | **129, 131, 244 ms** |
| rAF rate | 60.0 /s | 57.3, 56.8, 53.7 /s |

See §12, item 1.

**Bundle size.**

| Chunk | Phase 01 | Phase 02 |
|---|---|---|
| Main `index` JS | 465.9 KB (152.2 gzip) | **354.5 KB (108.4 gzip)** |
| WebGL (three, R3F) | 919.1 KB (243.1 gzip) | merged below |
| `ExperienceCanvas` | 97.3 KB (27.9 gzip) | **1,027.1 KB (274.2 gzip)**, includes all scenes |
| `RunLattice` | 6.0 KB (2.9 gzip) | merged above |
| CSS | 80.0 KB (15.6 gzip) | 79.9 KB (15.6 gzip) |

Reading these honestly:
- **The main-bundle saving is mostly temporary.** The 111 KB drop (44 KB gzip) comes from nothing importing GSAP right now. Phase 03 will add it back.
- **The WebGL chunk is effectively 1 MB at load now.** The Workbench and postprocessing code used to load near `#method`; because they share the canvas chunk, they now arrive with the hero: 102 KB more up front (28 KB gzip) than the 925 KB the hero loaded before, including on phones, which never use the Workbench.

## 11. Screenshots

All are in `site/qa-screenshots/phase02/` (gitignored). Raw measurements: `perf-baseline.json`, `perf-new.json`.

| Set | Files |
|---|---|
| Before (Phase 01) | `before/1440-hero.png`, `1440-method.png`, `390-hero.png`, `390-method.png` |
| After, at 1440, 1920, 768, 390, 375 | `after/<width>-hero.png`, `-lattice.png`, `-workbench.png`, `-nowebgl.png` |
| Resize | `after/resize-1024.png`, `resize-600.png` |
| Switching evidence | `after/switch-00.png` … `switch-10.png` (hero → Workbench, 11 frames) |

**Reviewed by eye:** the hero before/after at 1440 (same framing and colours); the Workbench at 1440; the lattice at 390; the
lattice tracking the page and clipping under the header (`switch-01`); nothing stale once it is off screen (`switch-03`); the
resize to 600. Hover and click, the fallbacks and console errors are covered by e2e and the capture script ("no console errors").
I did not open every capture individually, and no video was recorded; the frame sequence is the evidence for switching.

## 12. Remaining known issues

1. **Short stall on the hero, a regression.** During a pointer sweep over the lattice, one or two frames take far longer than before: 129–244 ms worst across three runs, against 26 ms in Phase 01. It is not sustained, and there are no main-thread long tasks. Traces show it at the same moments as a smaller baseline stall (about 30 ms), so an existing cost got several times larger; the likely factor is the full-screen canvas now under the page.
   - **Tried:** moving the cursor write off `<body>` helped (about 10 gaps per sweep down to 2) and is kept.
   - **Ruled out:** dynamic buffer usage made no difference, and a separate compositor layer for the readout made no difference. Both were reverted.
   - **Partly explains it:** antialiasing off reduced the stall from about 120 to 85 ms, but was not kept because it softens the lattice's edges.
   - **The root cause is not established.** It is worth a look before Phase 04 adds more to the hero.
2. **Workbench code loads on phones** although it never runs there (§10). Splitting it back into a lazy chunk is a small, contained change for a later phase.
3. **One-frame lag is still possible** between the page and the 3D while scrolling on slower devices. The canvas is fixed and redrawn, so it cannot be perfectly locked to native scrolling. Waking inside the scroll event and reading the rect in the frame keep it minimal.
4. **Low tier:** the lattice now renders at a pixel ratio capped at 1.5 on phones (it was 2), because the shared canvas is full-screen. It is slightly softer on high-density phones. Not measured on a real phone.
5. **MSAA is now on for the full-screen canvas**, needed to keep the lattice's edges. The cost has not been isolated beyond the hover figures in item 1.
6. **Entrance timing changed on phones.** The build-in now starts when the lattice first scrolls into view, not at page load, because off-screen scenes do no work. On a phone that means the reader actually sees it, but it is a behaviour change worth your review.
7. **Older layout issues, unchanged:** lane labels clip at the left of the stage at about 600–760 px wide (`resize-600.png`; the CSS rule predates this phase), and the Workbench board slightly overruns the bottom edge of its stage.
8. **`__upliftDiag.renderer().calls`** reports only the last `gl.render` of a frame, so it reads low with the bloom composer. Use it for geometry and texture counts; `perf.mjs` is the source for draw calls.
9. **Not tested:** real mobile GPUs, a real context-loss event mid-session (the e2e test simulates context creation failing), and browsers other than Chromium.

Phase 03 not started. Waiting for review.
