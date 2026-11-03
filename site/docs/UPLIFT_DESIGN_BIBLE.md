# Uplift design bible

> **Original Uplift identity: dark obsidian, Nebula spectral colours, Ember orange, warm ivory
> typography and restrained technical surfaces.**
>
> DARK. NEBULA. EMBER. ALWAYS.

This file is the standing visual rule set for `site/`. It overrides `site/BRIEF.md` wherever they
conflict. In particular, BRIEF.md's "neutral palette" and "must work in light and dark mode" are
**withdrawn**. The evidence and recovered values are in
[UPLIFT_ORIGINAL_IDENTITY_AUDIT.md](UPLIFT_ORIGINAL_IDENTITY_AUDIT.md).

## Theme
- Exactly one theme: **dark**. There is no light theme, no light sections, no toggle, no
  `prefers-color-scheme` switching and no stored theme preference.
- No white or bright-grey full-width surfaces, and no white panels between dark sections.
- Every section and component draws from the same token set in `src/styles/tokens.css`. Do not
  scope per-section palettes.
- `color-scheme: dark`; `theme-color #090A0C`.

## Colour roles
| Role | Tokens |
|---|---|
| Background | `--obsidian #090a0c` |
| Surfaces | `--carbon #101214`, `--graphite #171a1d`, `--elevated #202428`; rules `--border #303337`, `--border-soft #22262a` |
| Brand | `--ember #ff7138`, `--burnt #c9552d`, `--apricot #ffb17a` |
| Typography | `--text #f5f1eb`, `--text-2 #a8a29b`, `--text-3 #77716b` (decoration only, below 4.5:1) |
| Atmosphere (Nebula / 3D) | `SPECTRAL` in `src/scenes/palette.ts`: cyan, blue, violet, magenta, amber, warm core |
| Conditions | `STREAM_COLORS`: one fixed hue per experimental condition |
| Outcomes | `--ok #63c78c` solved, `--warn #e7b45a` mixed, `--fail #f07868` failed, always paired with a glyph |

- Ember means brand, selection, focus and progress. A solved outcome is never coloured orange.
- No lime or phosphor green as an accent. Green appears only as the "solved" outcome.
- No purple "AI gradient", no generic starfield, no cool blue-grey slate theme.
- 3D materials take their colours from `palette.ts` and the outcome tokens, not from hex literals.

## Nebula
The Nebula is an identity asset. Its spectral ramp (cyan → blue → violet → magenta) around a warm
amber/ivory core is the atmosphere for the whole site. The 77-bug atlas evolves the original Signal
Field (`git show 09549a9:site/src/scenes/SignalField/`); it does not replace it.

## Type and shape
- Geist Variable for text, Geist Mono for labels, data and code. Use mono uppercase tracked labels
  for eyebrows.
- Readability: 17 px body, 66ch measure, balanced headings. The final scale is in the audit, §7.
- Radii `--radius 10px` / `--radius-sm 6px`; easing `--ease-out cubic-bezier(0.16, 1, 0.3, 1)`.

## Change log
- 2026-11-04: created. It replaces the Phase 2 "publication palette" direction. No earlier design
  bible existed, and no phosphor/lime instructions were found to remove.
