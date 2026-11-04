# Phase 01 closeout: original identity restoration

2026-11-04, branch `redesign/experiment-atlas`, uncommitted. This is verification only: no source,
style or data file changed in this step. Spec: [UPLIFT_ORIGINAL_IDENTITY_AUDIT.md](UPLIFT_ORIGINAL_IDENTITY_AUDIT.md)
and [UPLIFT_DESIGN_BIBLE.md](UPLIFT_DESIGN_BIBLE.md).

**Method.**
- The checks ran against a fresh production build in a temporary folder (`vite build --outDir <scratch>`).
- It was served with `vite preview --outDir <scratch> --base /uplift/ --port 4173`. The served stylesheet hash `index-Wypz1u0k.css` matched the fresh build, so the stale `site/dist` was not used.
- Runtime values come from `getComputedStyle` in Chromium. The script is `qa-screenshots/closeout-check.mjs`, and the raw output is `qa-screenshots/phase01-closeout/runtime-checks.json` (both gitignored).

## 1. Theme verification

| Check | 1440×900 | 390×844 | Result |
|---|---|---|---|
| Body background | `rgb(9, 10, 12)` | `rgb(9, 10, 12)` | ✓ `#090a0c` |
| Root `color-scheme` | `dark` | `dark` | ✓ |
| `<meta name="color-scheme">` | `dark` | `dark` | ✓ |
| `<meta name="theme-color">` | `#090A0C` | `#090A0C` | ✓ |
| Section backgrounds (`main > section` ×10) | all `rgba(0,0,0,0)` (obsidian body shows through) | same | ✓ no light sections |
| Footer background | `rgb(16, 18, 20)` (carbon) | same | ✓ |
| Light-surface sweep (every visible element with alpha ≥ 0.5 and luminance above `--elevated`) | only ember fills, outcome markers, legend swatches, figure tiles | same | ✓ no light panels (§1.1) |
| Nav while scrolling (7 samples, top → bottom) | class `nav`, bg `rgba(9, 10, 12, 0.92)` at every sample | same | ✓ never changes |
| Nav active marker | underline `rgb(255, 113, 56)` at every sample; label follows the section | same | ✓ ember |
| Page errors / console errors | none | none | ✓ |

### 1.1 Light-surface sweep: everything it found
None of these is a panel or surface. Each is a deliberate brand or semantic mark:
- ember `rgb(255,113,56)`: the skip link, the primary button, pressed segmented buttons, pressed filter pills, and the selected 2D tile;
- outcome colours: matrix mini-cells `mc--2/1/0` (309/48/105), lamps and bars `l-*`/`b-*`, hook dots, the exposure bars `tier-bar`/`arm-bars__fill`;
- legend swatches and figure ticks in `--text`/`--text-2`: `k-run`, `d-run`, `lg-dot`, `lg-ci`, the 2D test tiles `t-test`, and the score markers.

### 1.2 Theme-switching removal: evidence
- **Code.** A search of `site/src` and `site/index.html` finds 0 hits for `--p-`, `--d-`, `pub--dark`, `is-dark`, `prefers-color-scheme` and `data-theme`.
  `tests/unit/palette.test.ts` › "no retired colour systems" enforces this on every test run.
- **`Nav.tsx`.** The `dark` state, its hero-position check and the `is-dark` class are gone. The header renders
  `className={`nav${open ? ' is-open' : ''}`}`. Scroll-spy and the mobile menu are unchanged, and e2e tests 3 and 18 pass.
- **Runtime.** The nav class was exactly `nav`, with an unchanged background, at all 7 scroll samples at both sizes (§1).

## 2. Token verification

`tests/unit/palette.test.ts` (25 tests, all passing) asserts:
- every value below from `tokens.css`;
- that `src/scenes/palette.ts` matches it value for value;
- the condition mapping.

| Token | Required | `tokens.css` | `palette.ts` | |
|---|---|---|---|---|
| `--ember` | `#ff7138` | `#ff7138` | `INTERFACE.ember #FF7138` | ✓ |
| `--text` | `#f5f1eb` | `#f5f1eb` | `INTERFACE.text` | ✓ |
| `--text-2` | `#a8a29b` | `#a8a29b` | `INTERFACE.text2` | ✓ |
| `--text-3` | `#77716b` | `#77716b` | `INTERFACE.text3` | ✓ |
| `--ok` | `#63c78c` | `#63c78c` | `OUTCOME.solved` | ✓ |
| `--fail` | `#f07868` | `#f07868` | `OUTCOME.failed` | ✓ |
| `--warn` | `#e7b45a` | `#e7b45a` | `OUTCOME.mixed` | ✓ |
| `--obsidian / --carbon / --graphite / --elevated` | `#090a0c / #101214 / #171a1d / #202428` | same | `INTERFACE.*` | ✓ |
| `--border / --border-soft` | `#303337 / #22262a` | same | `INTERFACE.*` | ✓ |
| `--burnt / --apricot` | `#c9552d / #ffb17a` | same | `INTERFACE.*` | ✓ |
| `--sp-cyan … --sp-core` | `SPECTRAL` (`09549a9`) | `#00c9ef #247ceb #6553c7 #e54291 #ffb66f #ffe5ac` | `SPECTRAL` unchanged | ✓ |

**Six conditions.** `STREAM_COLORS = [core, cyan, blue, violet, magenta, amber]` is unchanged.
- In 3D, `CONDITION_COLOR` maps it in arm order: none, prose, sensors, both, handwritten, tuned.
- In CSS, `--cond-<arm>` maps it as `var(--sp-…)`, in the same order.
- Both are asserted.

**`--text-3` uses.** Six remain, all non-text or non-essential decoration:
- the `.approach` top rule;
- diff line numbers and +/− signs (`.dl__ln`, `.dl__sign`);
- the detectable-effect tick in the chart and in the legend (`.ic-det`, `.lg-det`);
- the unexposed exposure bars (`.tier-bar`).

No body copy or informational small label uses it. Readable small text uses `--text-2`, at 7.8:1 on obsidian.

## 3. Remaining legacy implementation

**Retired systems: none live.** No `--p-*` or `--d-*` definitions or uses, no `.pub--dark`, no `.nav.is-dark`,
and none of the obsolete publication blues (`#4269d5 #3156bd #7d9cf2 #8fabff #a9bfff #c9d6ff #0c1117 #eef1f5
#a7b0bc #6f7a88 #141a22`, `rgba(66,105,213,…)`) or light literals (`#fff #fafaf8 #f6f6f3 #ecece8 #f4f3ef
#efeee9`).

**Structural classes kept on purpose.** `.pub`, `.pub-container`, `.pub-head`, `.pub-title`, `.pub-lead`, `.pub-figure`
and `.pub-table` carry layout and type only; their colours come from the tokens. `.seg-dark` is the single
segmented-control style, now with no light or dark variants.

**Token definitions that nothing references** (dead, harmless, left in place):

| Token | Status |
|---|---|
| `--fs-display`, `--measure`, `--s-1`, `--s-8` | **unused**: the hero title has its own clamp, and readable measures are set per component (`66ch`, `62ch`) |
| `--cond-none … --cond-tuned` | **live**, reached through `condStyle()` (`src/utils/condition.ts`) via a template string, so a plain grep misses them |
| every other token | referenced |

**Legacy `app.css` selectors.** These were counted as elements in the fully mounted page at both sizes.

| Selectors | Elements | Status |
|---|---|---|
| `.skip-link`, `.experience` (3D canvas wrapper), `.tag`, `.status` | 1, 1, 157, 4 | **live** |
| `.btn`, `.btn--ember`, `.btn--ember-ghost`, `.btn--ghost`, `.btn--small`, `.badge*`, `.mini*`, `.section-head*`, `.card`, `.card__bar`, `.data-table`, `.icon-btn`, `.kv`, `.kv--wide`, `.label`, `.label--ember`, `.label--muted`, `.tight`, `.tooltip`, `.skeleton*`, `.chip`, `.fine`, `.container`, `.section` | 0 | **dead CSS** from the original site. Their colours already come from the original tokens, so they are not a theme risk. I left them in place, as the brief asked. They are candidates for removal in a later cleanup, and some, such as `.btn--ember` and `.label--ember`, are the original primitives that later phases may reuse. |

## 4. Original UI identity

| Element | Evidence (computed, 1440×900) | |
|---|---|---|
| Background grid | `body::before`: two 1px `rgba(255,255,255,0.024…0.025)` line gradients, `background-size: 64px 64px`, `mask: radial-gradient(at 50% 30%, black 20%, transparent 75%)` | ✓ original |
| Warm charcoal hierarchy | `.pub-figure` `rgb(16,18,20)` carbon → `.rboard__group` `rgb(23,26,29)` graphite → `.mx-th__n` `rgb(32,36,40)` elevated; footer carbon | ✓ |
| Ember primary button | `.pbtn--primary` bg `rgb(255,113,56)`, ink `rgb(23,10,4)`, radius `999px` | ✓ original `.btn--ember` |
| Secondary / pill controls | `.pbtn` graphite, `--border`, `999px`; pressed `.seg-dark` and `.seg__btn` ember fill and ink, `999px` (on phones `.seg-dark` softens to 12–16 px so a two-line control still reads as one) | ✓ |
| Focus indicator | Tab → `a.nav__brand`: `2px solid rgb(255,113,56)` | ✓ |
| Nav active state | `::after` underline `rgb(255,113,56)` | ✓ |
| Warm typography | body `rgb(245,241,235)` 17 px / 27.2 px Geist Variable; lead `rgb(168,162,155)` 20.8 px; eyebrow Geist Mono 11.52 px (0.72rem) uppercase, 0.12em, ember; links apricot `rgb(255,177,122)` | ✓ |
| Dark code panels | `.diff`, `.md pre`, `.worked__sql` all `rgb(9,10,12)`; `.diff__bar` graphite; original dark diff row colours | ✓ |

## 5. Screenshots

All in `site/qa-screenshots/phase01-closeout/` (gitignored). They were taken from the fresh build after the runtime checks.

| Section | 1440 × 900 | 390 × 844 |
|---|---|---|
| Hero | `1440x900-hero.png` | `390x844-hero.png` |
| Findings | `1440x900-findings.png` | `390x844-findings.png` |
| Experiment | `1440x900-experiment.png` | `390x844-experiment.png` |
| WINDOW (worked example) | `1440x900-window.png` | `390x844-window.png` |
| Matrix | `1440x900-matrix.png` | `390x844-matrix.png` |
| Integrity | `1440x900-integrity.png` | `390x844-integrity.png` |
| Footer | `1440x900-footer.png` | `390x844-footer.png` |

The ember ring around the "Uplift" wordmark in these screenshots is the focus indicator left by the
Tab focus check, which runs just before them. It is not a styling defect.

The Phase 01 five-width set (375, 390, 768, 1440 and 1920, every section) is in `site/qa-screenshots/identity/`.

## 6. Regression tests (exact results)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, no errors |
| `npx vitest run` | **6 files, 61 tests passed** (36 existing + 25 in `palette.test.ts`) |
| `npx vite build --outDir <scratch>/dist --emptyOutDir` | ✓ built in 1.41 s; CSS `index-Wypz1u0k.css` 79.97 kB (15.59 kB gzip); `index` JS 465.94 kB (152.19 kB gzip) |
| `npx playwright test --output <scratch>/pw` against that build | **22 passed (54.4 s)**, 0 failed, 0 skipped |

## 7. Remaining issues (none block the identity spec)

1. **3D Workbench contrast.** The model reads correctly, but its warm-graphite surfaces are low-contrast and fine detail (workspace glass, rails) is subdued. This is better handled with lighting in the Experiment Bench phase than with more colour changes.
2. **Matrix at about 768 px.** The "never solved" label in the ceiling bar is clipped, and the condition column headers are cramped. These are older layout issues, not colour.
3. **Nav translucency.** At 92 % opacity, content scrolling underneath shows faintly through the header.
4. **No-WebGL hero figure.** Its legend and caption sit below the figure panel rather than inside it (older layout).
5. **Dead CSS.** Four unused tokens and the original `app.css` primitives listed in §3 remain. They are harmless; removing them is a later cleanup.
6. **Python tests** were not part of this phase and still cannot run locally, because pytest is not installed (see [UPLIFT_REDESIGN_AUDIT.md](UPLIFT_REDESIGN_AUDIT.md) §9).

Phase 01 status: **verified**. Waiting for review; Phase 02 not started.
