# Phase 02.1: performance remediation and responsive closeout

2026-11-04, branch `redesign/experiment-atlas`, uncommitted. No research data, statistics, palette or brand decision changed.

**Headline.** The hero stall is gone and all three frame-time targets are met on the reference machine. The Workbench
and bloom code now load as a separate chunk that phones and tablets never request. The lane-label and board-overrun
defects are fixed. One correction to earlier reporting: my Phase 02 explanations (full-screen compositing, DOM repaint,
MSAA) were wrong, and §2 says what the evidence showed instead.

## 1. Reference and method

- **Machine:** Intel Iris Xe (the only GPU), Windows, Chromium through Playwright with ANGLE/D3D11, 1440×900. Results apply to this machine.
- **Instrument:** `scripts/qa/sweep.mjs` runs ten identical pointer sweeps across the stage, 600 ms apart, and records every rAF delta. It works on any build.
- **Builds:** Phase 01 and Phase 02 production builds were kept unchanged and measured with the same tool.
- **Fairness:** the first Phase 01 run looked far worse than later ones (26 frames over 100 ms, then 0). Single runs on this machine are not reliable, so the comparison in §4 is **interleaved**, three rounds of final → Phase 02 → Phase 01 under the same conditions.

## 2. Root cause

**The hover lift wrote into a WebGL instance buffer as a partial upload, and that write produced a long GPU-process stall.**
The stall appeared once per sweep, as soon as the pointer first reached the cubes after a rest.

| Evidence | Result |
|---|---|
| Interleaved runs | Phase 02 stalls exactly **once per sweep** (10 frames over 100 ms in each of 3 rounds). Phase 01 does not (§4) |
| Chrome trace | In the worst gaps, one `WebGL` → `CommandBuffer::Flush` slice held the GPU process main thread for **338–464 ms**, while page JavaScript took about 10 ms. So it is not a main-thread stall |
| Stall position | Clusters around 0.25 of the sweep, where the pointer first reaches the cubes |
| Removing the hover lift | Frames over 100 ms: 23–25 → **0**, worst 450–750 → 83 ms |
| Removing raycasting and parallax | **0** frames over 50 ms, worst 33 ms |
| The fix: no instance writes at all | **0** frames over 50 ms in every run, **0 KB/s** uploaded during hover |

**Isolation matrix** (ten sweeps each, pooled, Phase 02 code plus one temporary switch, since removed):

| Variant | p99 ms | Worst ms | > 50 ms | > 100 ms |
|---|---:|---:|---:|---:|
| Control (run 1 / run 2) | 66.7 / 83.4 | 450 / 750 | 33 / 33 | 23 / 25 |
| No main pass | 33.4 | 417 | 22 | 14 |
| No MSAA | 33.3 | 333 | 17 | 11 |
| No pointer parallax | 66.6 | 283 | 32 | 10 |
| No DOM readout update | 66.7 | 467 | 30 | 19 |
| No cursor change | 50 | 650 | 26 | 17 |
| No raycast (so no hover, no lift) | 16.8 | 200 | 3 | 2 |
| **No hover lift** | 16.8 | **83** | 6 | **0** |
| **No raycast + no parallax** | 16.8 | **33** | **0** | **0** |

Those absolute counts run higher than the interleaved Phase 02 figures, so treat them as relative. They show what mattered:
only removing the lift removed the stall.

**Ruled out as the cause:** full-screen canvas compositing, scissored rendering, stage event computation, the main pass,
MSAA, DOM layout and paint, and bloom (not active on hero frames). Some reduce the numbers slightly, but none removes the stall.
A trace of the final build over 3 sweeps has **0** animation-frame gaps above 33 ms.

**Why Phase 01 was clean:** it rewrote the whole buffer on every frame. Phase 02 replaced that with a small targeted write
(`addUpdateRange`), and that targeted write after a rest is what stalled. It was a cost of the Phase 02 optimisation.

**Not established:** the reason inside ANGLE or the driver. I can show which write triggers the stall and that removing it
ends the stall, but not what the driver does internally. My earlier static-buffer theory was tested and did not help.

## 3. Corrections

**No instance data is uploaded after the build-in.**

- **Instance colours** hold each run's real outcome and are written once.
- **Per-bug uniform arrays** in the lattice's vertex shader carry the rest: `uLift` (hover and focus lift), `uDesign` (design ↔ outcomes view), `uGlow` (ember focus). A static `aBug` attribute maps each instance to its bug.
- The colour buffer had the same risk, so it got the same treatment. An intermediate build still writing colours showed 67–100 ms on each Design-mode step and 283 ms on a view toggle. Those stalls did not recur in the final build.

Behaviour kept: 924 instances, hover, click, keyboard stepper, selection, ember focus, one renderer, MSAA on.

Two small behaviour differences:
- **Picking uses the resting cube positions**, so a lifted bug is hit-tested where it rests. It is not noticeable at a 0.3-unit lift, and it stops a rising cube from moving out from under the pointer.
- **The outcomes colour sweep now staggers by bug only.** The previous extra lane delay (up to 0.1 s) is gone.

**Kept from earlier work:** the hover cursor set on the stage instead of `<body>`.

## 4. Before and after

**Interleaved, pooled over ten sweeps per round (ms).** Target: p95 ≤ 16.7, p99 < 33.3, no stall above 50.

| Build | Round | Median | p95 | p99 | Worst | > 50 | > 100 |
|---|---|---:|---:|---:|---:|---:|---:|
| Phase 01 | 1 / 2 / 3 | 16.7 | 16.7 / 16.8 / 16.8 | 16.8 | 16.8 / 33.5 / 33.4 | 0 | 0 |
| Phase 02 | 1 / 2 / 3 | 16.7 | 16.8 / 16.8 / 16.7 | 16.8 | **283 / 267 / 317** | **10 / 10 / 10** | **10 / 10 / 10** |
| **Final** | 1 / 2 / 3 | 16.7 | 16.7 / 16.8 / 16.7 | 16.8 | **16.8 / 16.8 / 33.3** | **0** | **0** |

Three further ten-sweep runs on the final build: worst 16.8 ms, 0 over 50 ms. In all, 60 final-build sweeps had none over 50 ms.

**Against the targets:**
- **No unexplained stall above 50 ms in ten sweeps: met.**
- **p99 below 33.3 ms: met** (16.8).
- **p95 ≤ 16.7 ms: met in substance, not always literally.** p95 reads 16.7 or 16.8 between runs. That is one 60 Hz frame with clock rounding: no frames are being dropped. Phase 01 reads the same.

| `perf.mjs`, hero with pointer moving | Phase 01 | Phase 02 | Final |
|---|---:|---:|---:|
| rAF rate | 60.0 | 53.7–57.3 | **60.2** |
| Worst frame | 26 ms | 129–244 ms | **22 ms** |
| GPU upload | 4,088 KB/s | 63.5 KB/s | **0 KB/s** |

Idle, off-screen and Workbench-idle rendering all stay at **0** frames. There is 1 context and 1 canvas after five scene switches.

## 5. Bundle splitting

| Chunk | Phase 02 | Now |
|---|---:|---:|
| `ExperienceCanvas` | 1,027.1 KB (274.2 gzip) | **933.4 KB (248.8 gzip)** |
| `WorkbenchLayer` (new, lazy) | in the above | **95.7 KB (27.1 gzip)** |
| Main `index` | 354.5 KB (108.4 gzip) | 355.3 KB (108.9 gzip) |

- **`src/scenes/Workbench/WorkbenchLayer.tsx`** holds the scene, the bloom composer and the Workbench shader precompile, and is the only importer of `@react-three/postprocessing`. It renders inside the existing `<Canvas>`: there is no second canvas or renderer.
- **It is verified, not assumed.** The built canvas chunk is checked in e2e to contain no bloom or Workbench strings, and source guards enforce the single boundary.
- **Loading:** it loads when the scene is requested and near. Until then the plain main pass draws, so the shared canvas keeps working while the chunk arrives.
- **Failure:** a failed download, or a Workbench scene error, leaves the section on its 2D diagram. The lattice, the canvas and `ui.webgl` are unaffected, and no error surfaces. E2e blocks the request to prove it.

**Real requests through a full-page scroll** (`network.json`, compressed sizes from the preview server, KB):

| Width | CSS | `index` | `ExperienceCanvas` | `markdown` | `WorkbenchLayer` | Total |
|---|---:|---:|---:|---:|---:|---:|
| 375, 390, 600, 768 | 15.5 | 105.9 | 241.5 | 25.2 | **not requested** | **388.1** |
| 1024, 1440, 1920 | 15.5 | 105.9 | 241.5 | 25.2 | 26.7 (near `#method`) | 414.8 |

The 3D Workbench applies above 900 px, so 768 uses the 2D diagram like phones.

## 6. Responsive corrections

- **Lane labels.** The rule that shows names out-ranked the mobile rule that hides them. A container query on the stage now shows number badges only when the stage is 640 px or narrower, and the readout beneath names each number. This also covers 1024, where the two-column hero makes the stage narrow. Tested at 600, 700, 768, 1024, 1440.
- **Workbench overrun.** The fit assumed an orthographic view, but the camera is perspective, so the near edge was larger than calculated. New pure `fitToStage()` (`scenes/Workbench/layout.ts`) measures the projected box and corrects it. The bottom edge sits 35.5 px inside the 592 px stage at 1440 and 1920, and 28.3 px inside at 1024. The board is therefore slightly smaller than before.
- **Overflow.** `overflowX` is 0 at all seven widths.

Screenshots: `site/qa-screenshots/phase021/<width>-lattice.png` and `<width>-workbench.png` at 375, 390, 600, 768, 1024, 1440, 1920.
Reviewed by eye: 600 and 1024 lattice, 1440 lattice and Workbench. The others are covered by the e2e geometry checks.
Some lattice shots catch the normal colour sweep mid-way, 3.5 s after load.

## 7. Test results

Final code, against its fresh build in a temporary folder (served hash `index-DZ5QrBg1.js` matched the build).

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | **9 files, 103 tests passed** (17 new) |
| `npx vite build --outDir <scratch>` | built |
| `npx playwright test` | **44 passed**, 0 failed (14 new) |
| Console errors across seven widths | none |
| Python tests | not run: pytest is not installed; no Python changed |

**New e2e:** phones and tablets never request the chunk; desktop loads it only on approach, with no bloom code in the canvas
chunk; a blocked chunk falls back cleanly; hover still changes the picture (checked under reduced motion, where nothing else
moves); the stepper updates the lattice with **no buffer upload**; labels inside the stage at 5 widths; the board inside the
stage at 3 widths; no overflow at 7 widths. The single-canvas, scene-switching, WebGL-fallback and reduced-motion tests all still pass.

## 8. Remaining limitations

1. **One machine.** All timings are this Iris Xe laptop. Real phones and other GPUs are unmeasured, and the driver mechanism is unknown, so other hardware may differ.
2. **Stepping in Outcomes view** still shows two ~50 ms frames across eight steps. The same happens on Phase 01 and Phase 02 and I have not diagnosed it. It is outside the sweep target and does not grow with use.
3. **Phones still download 933 KB of WebGL code** (249 KB gzip) for the hero lattice. That is three.js and R3F. Reducing it further needs a separate look.
4. **The first Workbench view** now waits for one extra chunk. It starts loading more than a screen before the stage arrives, so it is normally ready. On a slow connection the stage is briefly empty, with no spinner, and its labels sit unpositioned until the scene mounts. I did not test this on a throttled connection.
5. **The build-in still writes instance matrices** during its ~2 s entrance, by design and bounded. If a stall occurs there it would be hidden inside the entrance; the sweeps do not measure it.
6. **`sweep.mjs` uses synthetic input.** Real pointer behaviour may differ. No manual feel test was done.
7. **Older item from Phase 02 still open:** lattice pixel ratio capped at 1.5 on low-tier devices.

Phase 03 not started. Waiting for review.

## Later correction
A later probe found a stall this report's measurement did not show: on a fresh page, the first contact with the hero
stalls 300 to 500 ms in DOM raster. It reproduces on this phase's commit. See `ATLAS_EXECUTION_LOG.md`.

