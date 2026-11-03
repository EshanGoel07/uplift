# Uplift original identity audit

Read-only audit, 2026-11-04. Nothing in `src/` was changed. The redesign waits for approval.

**Sources.** The original identity is commit `09549a9` ("Add results website source (site/)"),
the first commit that contains `site/`. It is quoted below as `09549a9:<path>`, readable with
`git show 09549a9:site/<path>`. "Current" means the uncommitted working tree on 2026-11-04,
after BUILD_LOG Phases 2 and 2b.

**Limit.** The original website recording and the reference recordings are not in the repo, so this
audit recovers the identity from source only. Where the recording might differ, that is noted.

---

## 1. Original palette (recovered from source history)

### Interface: `09549a9:src/styles/tokens.css` ("OBSIDIAN x EMBER interface")

| Role | Token | Value |
|---|---|---|
| Background | `--obsidian` | `#090a0c` |
| Surface 1 | `--carbon` | `#101214` |
| Surface 2 | `--graphite` | `#171a1d` |
| Surface 3 | `--elevated` | `#202428` |
| Rule | `--border` | `#303337` |
| Rule (soft) | `--border-soft` | `#22262a` |
| Brand accent | `--ember` | `#ff7138` |
| Accent, deep | `--burnt` | `#c9552d` |
| Accent, light (links) | `--apricot` | `#ffb17a` |
| Accent washes | `--ember-12`, `--ember-24` | `rgba(255,113,56,.12)`, `.24` |
| Text, primary | `--text` | `#f5f1eb` |
| Text, secondary | `--text-2` | `#a8a29b` |
| Text, muted | `--text-3` | `#77716b` |
| Selected | `--selected` | `#ff7138` |
| Outcome: solved | `--ok` | `#63c78c` (+ `--ok-14` wash) |
| Outcome: failed | `--fail` | `#f07868` (+ `--fail-14`) |
| Outcome: mixed/warning | `--warn` | `#e7b45a` (+ `--warn-14`) |
| Ease | `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` |

The four reference values in the brief (`#ff7138`, `#f5f1eb`, `#a8a29b`, `#77716b`) are **confirmed**.

The original `app.css` (`09549a9:src/styles/app.css`):
- body `var(--obsidian)`, links apricot → ember on hover, `::selection` ember on obsidian, focus ring
  2px ember.
- a fixed 64 px background grid at 2.5% white, masked radially toward the top.
- pill buttons (`.btn`, 999px) on graphite, plus an ember primary (`.btn--ember`, ink `#170a04`).
- mono uppercase labels (`.label`, `.label--ember`).
- the nav: mono wordmark, a blinking ember caret, the active link marked with an inset ember underline,
  and an ember gradient progress bar (`--burnt` → `--ember`).

### Nebula / 3D: `src/scenes/palette.ts` (unchanged since `09549a9`)

| `SPECTRAL` | Value | Original use |
|---|---|---|
| `cyan` | `#00C9EF` | Nebula shell ramp, matrix surface |
| `blue` | `#247CEB` | Nebula ramp, matrix surface |
| `violet` | `#6553C7` | Nebula ramp, matrix low end |
| `magenta` | `#E54291` | Nebula ramp |
| `amber` | `#FFB66F` | Nebula core glow, matrix high end |
| `core` | `#FFE5AC` | Nebula warm core |

`STREAM_COLORS = [core, cyan, blue, violet, magenta, amber]`: one colour per condition, in data order
(used by the original `ExperimentStreams`).

The Nebula ("Signal Field") is `09549a9:src/scenes/SignalField/{materials,geometry,hotspots,hotspotRegistry}.ts`
and `SignalField.tsx`. Its shader ramp is cyan → blue → violet → magenta, from `SPECTRAL_RAMP` in
`src/scenes/shaders/noise.ts` (**still present**), around a warm `core`/`amber` centre with
simplex-noise displacement. The original `tokens.css` mirrored the spectral values as `--sp-*`, but
only for the static fallback poster (`public/assets/signal-field-fallback.jpg`, now deleted).

## 2. Current palette

`src/styles/tokens.css` still contains the full original set, now headed **"Legacy"**. Below it,
Phase 2 added a second identity, the **publication palette**:

| Token | Value | Note |
|---|---|---|
| `--p-canvas` | `#f4f3ef` | light page background |
| `--p-surface` | `#ffffff` | white panels (27 `background:` rules) |
| `--p-ink` / `-2` / `-3` | `#191d23` / `#5f6773` / `#8a919b` | dark text on light |
| `--p-border` / `-2` | `#dfe1e3` / `#c8cdd3` | light rules |
| `--p-blue` / `--p-blue-ink` | `#4269d5` / `#3156bd` | **replaces ember as the accent** |
| `--p-success` / `--p-mixed` / `--p-failure` | `#278a76` / `#d49a42` / `#be625c` | outcome colours re-tuned for white |
| `--p-stage*` | `#141a22`, `#1b232d`, `#2b3541`, `#e8ecf1`, `#a3adb9`, `#7d9cf2` | blue-grey "dark stage" |

`publication.css` adds a third, scoped dark set for `.pub--dark`: `--d-bg #0c1117`,
`--d-ink #eef1f5`, `--d-ink-2 #a7b0bc`, `--d-ink-3 #6f7a88`, `--d-rule rgba(255,255,255,.1)`,
plus literal blues `#a9bfff`, `#8fabff`, `#c9d6ff`.

`app.css` body background changed from `var(--obsidian)` to literal `#0c1117` ("light sections
paint their own background").

**So the site now has three colour systems:** Obsidian/Ember (legacy, largely unused), the light
publication palette, and a cool blue-grey dark stage. **Ember appears almost nowhere in the
rendered UI.** It survives only in leftover `app.css` rules (`::selection`, `.skip-link`,
`.btn--ember`).

## 3. Typography

| | Original (`09549a9`) | Current |
|---|---|---|
| Families | Geist Variable / Geist Mono Variable (`@fontsource-variable`) | Same |
| Display | `--fs-display` clamp(2.2rem … 3.45rem) | `--p-display` clamp(2.5rem … 4.6rem) |
| H2 | `--fs-h2` clamp(1.9rem … 3.3rem) | `--p-h2` clamp(1.85rem … 2.9rem) |
| H3 | `--fs-h3` clamp(1.15rem … 1.45rem) | `--p-h3` clamp(1.15rem … 1.35rem) |
| Lead | `--fs-lead` clamp(1.05rem … 1.3rem) | `--p-lead` clamp(1.1rem … 1.3rem) |
| Body | `1rem`, line-height 1.6 | `--p-body 1.0625rem`, `.pub-lead` 1.6, max 66ch |
| Small / label | `0.875rem` / `0.72rem` mono uppercase, 0.12em tracking | `0.9rem` / caption `0.875rem`; mono eyebrows |
| Headings | 600, −0.02em, lh 1.08 | 600, −0.03em, lh 1.08, `text-wrap: balance` |
| Features | `ss01`, `cv11`; mono `zero`, `tnum` | same body rules (from `app.css`) |
| Radius | `--radius 10px`, `--radius-sm 6px`, pill buttons | `--p-radius 6px`, rectangular buttons (`.pbtn`) |

The typeface is preserved. Two type scales now coexist, and the publication scale's larger display,
17 px body and 66ch measure are the readability gains worth keeping (see §7).

## 4. Root cause of the inconsistent light/dark styling

There is **no theme system**. No theme provider, no `data-theme`, no `prefers-color-scheme` query,
no theme toggle and no stored preference exist anywhere in `src/`. `index.html` declares
`<meta name="color-scheme" content="dark">`. The inconsistency comes entirely from **per-section CSS
scoping introduced by a design decision**:

1. **The brief asked for it.** `site/BRIEF.md` §Colour (lines ~341–343) asks for "a neutral palette"
   that "must work in light and dark mode", and the checklist (line ~359) repeats "in light and dark
   mode".
2. **Phase 2 (2026-11-03)** introduced the light publication palette as "the site's identity"
   (`BUILD_LOG.md` Phase 2, "Identity"). It is scoped through a `.pub` class on each redesigned
   section (`publication.css`), and the original tokens were relabelled "Legacy".
3. **Phase 2b (2026-11-04).** Review feedback said "the light redesign read as generic and plain".
   Instead of returning to the original identity, a **dark stage** was added for the hero only, as
   `.pub--dark` with its own cool `--d-*` palette, and later reused for Methodology. To match it,
   `Nav.tsx` (lines ~56–104) toggles an `is-dark` class while the hero is under the header. So the
   header itself switches theme on scroll.
4. `index.html` `theme-color` was changed from `#090A0C` to `#F4F3EF`, which tints mobile browser
   chrome light.
5. The body background was hard-coded to `#0c1117`, and every light section paints
   `--p-canvas`/`--p-surface` over it. The result is dark → light → dark → light banding down the
   page.

**Fix direction:** delete the scoping mechanism (`.pub` light defaults, `.pub--dark`, `.nav.is-dark`)
and restyle every section from one dark token set. Repainting the body alone would not fix it.

## 5. Theme-related files

| File | Role in the problem |
|---|---|
| `site/BRIEF.md` | Source requirement for light and dark mode and a neutral palette |
| `site/index.html` | `theme-color #F4F3EF` (originally `#090A0C`) |
| `src/styles/tokens.css` | Original tokens marked "Legacy"; `--p-*` light + stage palette |
| `src/styles/publication.css` (447 lines, new) | `.pub` light scope, `.pub--dark` + `--d-*`, `.nav.is-dark`, `.seg-dark`, `.pbtn` |
| `src/styles/sections.css` (225, new) | Light section styles (47 `--p-` uses) |
| `src/styles/explorer.css` (256, new) | Run explorer, diff and issue panels on white (97 `--p-` uses) |
| `src/styles/workbench.css` (208, new) | Methodology bench in the `--d-*` cool palette with literal blues |
| `src/styles/app.css` | Body `#0c1117`; legacy ember rules survive only partly |
| `src/components/navigation/Nav.tsx` | `dark` state + `is-dark` class switching |
| `src/scenes/RunLattice/RunLattice.tsx` | Hard-coded cool blues and outcome colours (below) |
| `src/scenes/Workbench/WorkbenchScene.tsx` | ~25 hard-coded slate/blue hexes (below) |
| `src/scenes/palette.ts` | Original `SPECTRAL`/`STREAM_COLORS`, **no longer imported by any live scene** |

## 6. Components requiring visual correction

| Component | File(s) | Current colouring | Required change |
|---|---|---|---|
| Navigation | `Nav.tsx`, `publication.css` (`.nav`, `.nav.is-dark`) | Light by default, switches dark over hero | One permanent dark header (obsidian at ~80–90% opacity), ember active marker; remove `is-dark` state |
| Hero | `Hero.tsx` (`pub pub--dark`), `HeroStage.tsx`, `RunLattice.tsx` | Cool `#0c1117` stage; lattice blues `#7d9cf2`/`#8fabff`/`#8592a6`, cubes `#18202a`, outcomes `#37b597`/`#d8665e` | Obsidian stage; spectral/ember accents; outcome cubes from shared `--ok`/`--fail`; pairing band ember (it is a selection, not an outcome) |
| Results chart | `Results.tsx`, `IntervalChart.tsx`, `publication.css` | Drawn "on white", grid-paper background | Dark surface (carbon/graphite), ivory/neutral marks, ember highlight for the selected row only |
| Methodology / Experiment Bench | `Methodology.tsx` (`pub pub--dark`), `WorkbenchDiagram.tsx`, `Inspector.tsx`, `workbench.css`, `WorkbenchScene.tsx` | `--d-*` palette, literal blues `#a9bfff`/`#c9d6ff`/`#8fabff`; 3D slate `#161e28`…`#c9d0d9`, violet `#c7a6ff`, warm `#c9a970`/`#e9e2cf`/`#f0bf72` | Map to obsidian/graphite surfaces, `--text*`, ember for selection, `STREAM_COLORS` per condition, `--ok/--fail/--warn` for outcomes |
| Experiment overview figure | `components/figures/ExperimentOverview.tsx` + `publication.css` | Light figure (SVG fallback for the hero) | Dark figure using the same tokens |
| Bug matrix | `BugMatrix.tsx` (`pub runs`), `sections.css` | White canvas, `--p-success/-mixed/-failure` | Dark; restore `--ok/--warn/--fail` with ✓/✗ glyphs kept |
| Run explorer / file explorer / code panels | `BugExplorer.tsx`, `RunBoard.tsx`, `RunPanel.tsx`, `Issue.tsx`, `DiffViewer.tsx`, `explorer.css` | White panels, light diff colours, blue links | Graphite panels, dark diff add/remove washes from `--ok-14`/`--fail-14`, apricot links |
| Worked example (WINDOW) | `WorkedExample.tsx`, `sections.css`/`explorer.css` | Light | Dark |
| Trust / integrity | `Trust.tsx`, `sections.css` | Light | Dark |
| Built vs used | `BuiltVsUsed.tsx` (`pub about`, `.pub-table`) | Light table | Dark table, sticky column on carbon |
| Limitations | `Limitations.tsx` (`pub about about--limits`) | Light | Dark |
| Future work | `FutureWork.tsx` (`pub about`) | Light | Dark |
| Footer | `Footer.tsx`, `publication.css` | Light (`pub-container`) | Dark (carbon) |
| Bridge | `components/navigation/Bridge.tsx` | Inherits the light/dark scope it sits in | Dark |
| Tooltips / readouts / skeletons | `.pub-skeleton*`, readout styles in `publication.css` | Light greys | Graphite/elevated with `--border` |
| Buttons and segmented controls | `.pbtn`, `.seg-dark` in `publication.css` | Ink-on-white and white-on-slate | One dark button primitive; ember primary |
| Focus / selection | `publication.css:16-17,120-121` | Blue focus rings, blue selection | Ember focus ring and selection (original) |
| Browser chrome | `index.html` `theme-color` | `#F4F3EF` | `#090A0C` |
| Modals | none found | n/a | When added, build from the same dark primitives |

Out of scope for this audit: `tests/e2e/site.spec.ts` and the QA screenshot scripts. A grep finds
no e2e assertion on `.pub` or `is-dark`, but the QA screenshots will need re-capturing after the redesign.

## 7. Recommended final tokens

One dark token set, **original values unchanged**, extended only where the redesign needs a role the
original lacked. No new hues.

```css
:root {
  color-scheme: dark;

  /* Background and surfaces (original) */
  --obsidian: #090a0c;   --carbon: #101214;   --graphite: #171a1d;   --elevated: #202428;
  --border: #303337;     --border-soft: #22262a;

  /* Brand (original): ember is the accent for brand, selection, focus and progress only */
  --ember: #ff7138;      --burnt: #c9552d;    --apricot: #ffb17a;
  --ember-12: rgba(255,113,56,.12);  --ember-24: rgba(255,113,56,.24);

  /* Text (original) */
  --text: #f5f1eb;       /* 17.6:1 on obsidian */
  --text-2: #a8a29b;     /* 7.8:1 obsidian, 6.2:1 elevated: all body and small text */
  --text-3: #77716b;     /* 4.1:1 obsidian, 3.2:1 elevated: rules, ticks, line numbers ONLY */

  /* Outcomes (original semantics; never ember) */
  --ok: #63c78c;   --fail: #f07868;   --warn: #e7b45a;   /* mixed = warn */
  --ok-14: rgba(99,199,140,.14);  --fail-14: rgba(240,120,104,.14);  --warn-14: rgba(231,180,90,.14);

  /* Nebula spectral, exposed to CSS so the HTML and 3D share one set (values = scenes/palette.ts) */
  --sp-cyan: #00c9ef; --sp-blue: #247ceb; --sp-violet: #6553c7;
  --sp-magenta: #e54291; --sp-amber: #ffb66f; --sp-core: #ffe5ac;

  /* Type: original families; readability gains from Phase 2 carried over */
  --fs-display: clamp(2.5rem, 1.35rem + 4vw, 4.6rem);
  --fs-h2: clamp(1.85rem, 1.25rem + 2.1vw, 2.9rem);
  --fs-h3: clamp(1.15rem, 1.05rem + 0.4vw, 1.35rem);
  --fs-lead: clamp(1.1rem, 1rem + 0.45vw, 1.3rem);
  --fs-body: 1.0625rem;  --measure: 66ch;
  --fs-small: 0.9rem;    --fs-label: 0.72rem;

  /* Shape: original */
  --radius: 10px;  --radius-sm: 6px;
}
```

Contrast ratios above are computed here (WCAG 2.x relative luminance). Ember `#ff7138` is 7.2:1 on
obsidian and 5.7:1 on elevated, and the outcome colours are ≥5.6:1 on every surface, so all are
usable as text on the dark surfaces.

**Rules that go with the tokens**
- `scenes/palette.ts` stays the 3D source of truth. Scene files import `SPECTRAL`/`STREAM_COLORS`
  and, for outcomes, the same values as `--ok/--fail/--warn` (e.g. an `OUTCOME` export in
  `palette.ts`). No hex literals in scene files.
- Each of the six conditions keeps its `STREAM_COLORS` hue everywhere (Bench, lattice, chart labels).
- Ember marks *selection / brand / focus / progress*. Outcome meaning stays green/amber/red, always
  paired with ✓/✗/glyphs.
- Remove `--p-*`, `--d-*`, `.pub--dark`, `.nav.is-dark`, `.seg-dark` and every literal blue.

**Decisions for the owner** (not resolved here)
1. **Mixed colour.** The original `--warn #e7b45a` vs the current `--p-mixed #d49a42`. The
   recommendation is the original.
2. **Button shape.** Original pills (999px) vs current 6px rectangles. The recommendation is the
   original pills, unless recording 03 shows otherwise.
3. **Type scale.** The proposal adopts the Phase 2 larger display and 17 px body as "recording 03
   readability". Please confirm against recording 03.
4. **The hero.** It is currently the 924-run lattice (Phase 2b). The fixed concept says 01 is the
   Nebula as the 77-bug atlas, so the lattice's role should be decided in a later phase.

## 8. Original design elements that must be preserved

1. **Permanent dark obsidian ground** (`#090a0c`) from hero to footer, with the masked 64 px technical grid.
2. **Ember `#ff7138`** as the single brand accent, with burnt/apricot as its only companions
   (gradient progress bar, links, hover, focus ring, selection).
3. **Warm ivory typography** `#f5f1eb` / `#a8a29b` / `#77716b`, with warm (not blue-grey) neutrals.
4. **The Nebula spectral palette** `SPECTRAL` and its ramp `SPECTRAL_RAMP` (cyan → blue → violet →
   magenta) around a **warm core** (`core #FFE5AC`, `amber #FFB66F`). The Signal Field source is
   recoverable from `09549a9:site/src/scenes/SignalField/` as the starting point for the 77-bug
   Nebula atlas.
5. **`STREAM_COLORS`**: the fixed one-colour-per-condition mapping.
6. **Semantic outcome colours** `--ok` / `--warn` / `--fail`, kept distinct from the brand.
7. **Geist Variable + Geist Mono**, including the mono uppercase tracked labels (`.label`, `.label--ember`).
8. **Warm charcoal surfaces** (carbon → graphite → elevated) with `#303337` rules and the
   `--ease-out` curve.
9. **One shared WebGL canvas** (`ExperienceCanvas.tsx`) behind the page, with the no-WebGL/static
   fallback discipline.
10. `color-scheme: dark` and `theme-color #090A0C`.
