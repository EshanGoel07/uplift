# Uplift results page: build brief

A complete brief for whoever builds the results website (human or agent). Read it in full before
writing code. Facts here come from `site/data/results.json`, `reports/main.md`, `SUBMISSION.md` and
`PHASE_LOG.md` as of 2026-11-02. If any of those files disagree with this brief, the files win.

---

## 1. What the project is (one paragraph for the builder)

Uplift answers one question: **does a coding-agent setup (an AGENTS.md tips file, hooks that run
checks, or both) actually help an agent fix bugs on *your* repo?** It turns a repo's own past bug
fixes into tasks graded by the repo's real tests, generates a repo-specific setup with Meta's
**Muse Spark**, then runs Meta's **Muse Code** agent on every task with and without each setup, and
compares. It was demonstrated on one repo, `tobymao/sqlglot` (a Python SQL parser/transpiler).

**The headline result is a null result:** across 924 runs on 77 real bugs, no setup measurably beat
having no setup. The page's job is to show that honestly and show *why the measurement can be
trusted*. Do not frame it as a win.

Context: built for the **Meta Global AI Developer Hackathon**, Indie track, problem statement
"Push the Frontier". Everything shown must be built during the event (Oct 26 to Nov 4, 2026). The
results page is credited to a named teammate in the submission, so that person should build it.

---

## 2. Required changes and hard rules

### 2.1 Trust section: one title change (requested by the team)

Use **"We caught and measured web leaks"** as the title of the web-leak trust card (80 of 924
runs reached the real fix or newer code; the result holds without them). Don't use "No leaked
answers" or anything else that suggests answers couldn't leak.

In the current `results.json` this card is `trust[4]`, titled
`"Clean workspaces, one gap found and measured"`. Override that title in the page (or change it at
the source in `src/uplift/analysis.py` and re-export with `uplift export`). Keep its `detail` text.

### 2.2 Wording rules (they apply to all copy)

- Claim nothing bigger than the evidence. Say "no setup was shown to differ from no setup", never
  "setups don't work" or "setups help".
- Never say the fix could not be looked up. Say we found the web leak ourselves and measured it.
- Always state the smallest difference the study could detect (5.4 to 9.1 points at 80% power).
- Never use "secure", "production-ready" or "X% faster".
- Say "demonstrated on sqlglot; the method is repo-independent" somewhere visible.
- The only models named as used: **Muse Code** (agent under test, model id
  `muse-spark-1.3-contributor`) and **Muse Spark** (setup generator, tuner, failure labeller).
  Don't mention or call any other model. The page itself calls no models at all.
- Arm labels: use the `label` values from the data, never the internal ids.

### 2.3 Technical constraints

- Static site only: no backend, no API keys, no network calls except fetching its own JSON.
- Must work when served from a sub-path (GitHub Pages: `https://<user>.github.io/uplift/`), so use
  relative URLs.
- `results.json` is 2.5 MB; 83% of it is agent diffs. Don't block first paint on it (see section 6).
- Accessible: colour must not be the only signal (pass/fail also gets a ✓/✗ or a text label),
  keyboard-navigable explorer, readable on a phone (the grid can scroll sideways).
- Don't edit anything outside `site/` except, if you choose, adding a split-data script. Don't touch
  `scripts/paid.sh`, `tools/budget_guard/` or `.claude/`. Don't run paid commands.

---

## 3. The data: `site/data/results.json`

Produced by `uplift export` (`src/uplift/analysis.py`). **All rates and differences are fractions**
(0.727 means 72.7%; `diff_vs_none` −0.00649 means −0.6 points). Top level has 4 keys:

### 3.1 `summary` (object)

```json
{ "runs": 924, "tasks": 77, "total_cost_usd": 21.31,
  "agent": "Muse Code (muse-spark-1.3-contributor)", "repo": "tobymao/sqlglot" }
```

### 3.2 `arms` (array of 6, in display order)

Fields: `id`, `label`, `solved`, `attempts`, `rate`, `diff_vs_none`, `ci_low`, `ci_high` (95%
interval of the paired difference vs no setup), `cost_per_solved` (USD), `regressions` (runs with
any PASS_TO_PASS test failure).

| id | label | solved | rate | diff vs none | 95% CI | $/solved | regressions |
|---|---|---|---|---|---|---|---|
| none | No setup | 112/154 | 72.7% | baseline | n/a | 0.0312 | 0 |
| prose | Tips file (generated) | 112/154 | 72.7% | +0.0 | −5.8 to +4.5 | 0.0317 | 0 |
| sensors | Hooks (generated) | 111/154 | 72.1% | −0.6 | −6.5 to +4.5 | 0.0313 | 0 |
| both | Tips + hooks | 111/154 | 72.1% | −0.6 | −7.1 to +5.8 | 0.0328 | 1 |
| handwritten | Generic copied tips file | 107/154 | 69.5% | −3.2 | −9.1 to +1.3 | 0.0339 | 2 |
| tuned | Tuned by Muse Spark | 113/154 | 73.4% | +0.6 | −2.6 to +4.5 | 0.0310 | 0 |

For `none`, `ci_low`/`ci_high`/`diff_vs_none` are 0 placeholders: don't draw an interval for it;
draw it as the zero reference line.

What each arm is (for tooltips and the "how it works" copy):
- **No setup:** the repo with its own CLAUDE.md and AGENTS.md removed (sqlglot added them in 2026),
  so "none" really is none.
- **Tips file (generated):** a 13-line AGENTS.md written by Muse Spark from the repo's docs, commit
  history, risk map and 150 dated code-review comments, all from before the test period.
- **Hooks (generated):** checks that run while the agent works: lint (ruff check and format on edited
  files), co-change warnings ("you edited parser.py but not generator.py"), and a verify step at the
  end that runs related tests and can block finishing (at most 2 blocks). The hooks are rendered by
  Uplift from Muse Spark's spec, so their format is always valid.
- **Tips + hooks:** both of the above.
- **Generic copied tips file:** a typical blog-style AGENTS.md, not specific to the repo
  (`arms/handwritten/AGENTS.md`). It's the control for "copying someone's setup".
- **Tuned by Muse Spark:** Muse Spark read failures on *dev* tasks only and rewrote the setup:
  an 11-line AGENTS.md, lint and verify kept, co-change dropped. Treat this as a hypothesis, since
  it was chosen from one-repeat dev differences.

### 3.3 `tasks` (array of 77)

```
{ id: "tobymao__sqlglot-4331" | "tobymao__sqlglot-fresh-63296846",
  set: "test" | "fresh",          // 39 test, 38 fresh
  title: string,                  // the GitHub issue title
  issue: string,                  // full issue text, markdown, may contain \r\n; 176-12,906 chars, median ~1.5K
  results: { <arm id>: { solved: 0|1|2,
                         runs: [ { seed: 1|2, resolved: bool, cost_usd: float,
                                   diff: string,          // unified git diff of the agent's patch, capped at 30,000 chars; median ~1.9K; one is empty
                                   hooks: string[] } ] } } }   // messages hooks sent to the agent; usually []
```

- Each task has all 6 arms, each with exactly 2 runs (seeds 1 and 2). "Seeds" are repeats: the
  number labels the run but isn't passed to the model.
- `test` tasks come from SWE-rebench (2024 sqlglot bugs). `fresh` tasks are bugs fixed in sqlglot
  between April and October 2026, mined from the repo by Uplift.
- `hooks` messages start with `"Uplift checks:\n"` and hold one or more checks separated by blank
  lines (`ruff format: ...`, `co-change: ...`, verify output). 217 of 924 runs have at least one.
  Only hook arms (sensors, both, tuned) can have them.
- Diffs often include test files the agent added; render the whole diff.
- To link a task to GitHub: for test ids, the number after `sqlglot-` is the upstream PR number
  (`https://github.com/tobymao/sqlglot/pull/4331`). Fresh ids end in a commit-hash prefix and have no
  reliable link in the data, so show no link for them.

Outcome patterns (compute them from the data rather than hardcoding):
- **43** tasks solved in every run by every arm, **11** never solved by any run, **23** mixed. Only
  the 23 mixed tasks can tell arms apart, so this is a ceiling effect with a strong agent.
- The two repeats of the same arm disagree on 48 of 462 task-arm pairs (the run-to-run noise).

### 3.4 `trust` (array of 6 `{title, detail}`)

Use these as the trust cards. Change the title of item 5 as described in 2.1. The current titles:
1. Snapshot leak checks: 0 of 40 test fixes and 0 of 40 fresh fixes in the setup's snapshots,
   with positive controls that do fire (24 of 40 dev, 30 of 40 fresh at HEAD).
2. Fresh 2026 bugs.
3. Dev and test kept apart.
4. A grader that fails closed: caught 3 hidden-failure formats.
5. ~~Clean workspaces, one gap found and measured~~ → **We caught and measured web leaks**.
6. Every run metered: $21.31 in the proxy ledger matches the sum of run costs.

---

## 4. Numbers NOT in `results.json` (copy verbatim from `reports/main.md`)

Either hardcode these as static content with a "source: reports/main.md" comment, or extend
`uplift export` to emit them. Don't invent or recompute them differently.

**Smallest detectable effect (must appear):** CI half-widths are ±3.6 to ±6.5 points; a real effect
needs to be **5.4 to 9.1 points** to be detected 80% of the time. Per arm (half-width / detectable):
tips ±5.2 / 7.4, hooks ±5.5 / 8.0, tips+hooks ±6.5 / 9.1, generic ±5.2 / 7.5, tuned ±3.6 / 5.4.
The 5 comparisons are not adjusted for multiplicity.

**Tasks won/lost vs no setup** (an arm solved more or fewer of a task's repeats):
tips 6/4, hooks 7/6, tips+hooks 6/7, generic 4/7, tuned 3/3.

**Cost:** $21.31 total for 924 runs, **$0.023 per run**. Total project spend $29.78 of a $100 cap.
Cost line for the page: "924 agent runs on real bugs for $21.31".

**Web leak (the trust card's evidence, show as a small table or expandable):**
| Most the run reached | Runs | Solved |
|---|---|---|
| The task's own fix diff | 59 | 57 |
| Newer upstream code | 21 | 21 |
| The task's own PR page | 7 | 6 |
| Another sqlglot PR or issue | 16 | 10 |
| Docs only, or no web | 821 | 572 |

By arm, exposed runs of 154: none 13, tips 12, hooks 16, tips+hooks 12, generic 15, tuned 12. By set:
test 73 of 468, fresh 7 of 456. It's a lower bound (URLs built at run time and search snippets aren't
detected). **Does the result survive?** Difference vs no setup, points (95% CI):

| View | Tasks | Tips | Hooks | Tips + hooks | Generic | Tuned |
|---|---|---|---|---|---|---|
| All tasks | 77 | +0.0 (−5.8, +4.5) | −0.6 (−6.5, +4.5) | −0.6 (−7.1, +5.8) | −3.2 (−9.1, +1.3) | +0.6 (−2.6, +4.5) |
| Without tasks where any run saw the fix or newer code | 51 | +0.0 (−5.9, +4.9) | −1.0 (−6.9, +4.9) | +1.0 (−5.9, +7.8) | −2.9 (−8.8, +2.0) | +0.0 (−3.9, +3.9) |
| Also without own-PR-page tasks | 50 | +0.0 (−6.0, +5.0) | −1.0 (−7.0, +4.0) | +1.0 (−6.0, +8.0) | −2.0 (−8.0, +3.0) | +0.0 (−4.0, +4.0) |
| Exposed runs counted as failed | 77 | +0.6 (−5.8, +6.5) | −1.9 (−8.4, +3.9) | +0.0 (−6.5, +6.5) | −3.9 (−11.0, +3.2) | +1.3 (−3.2, +5.8) |

Every interval still crosses zero.

**Test vs fresh solve rate** (optional chart; note the web leak clouds this comparison):
none 75.6% / 69.7%, tips 76.9 / 68.4, hooks 74.4 / 69.7, tips+hooks 71.8 / 72.4,
generic 69.2 / 69.7, tuned 76.9 / 69.7.

**Hook delivery:** tips+hooks 91 runs with a message (120 delivered, 3 fired too late); hooks 82
(123, 0); tuned 44 (58, 3). Co-change warnings were followed ~28% of the time on dev.

**Why runs failed (258 failed runs).** Rule-based facts per arm (failed / edited none of the fix's
files / broke PASS_TO_PASS / never ran tests / hit step limit): none 42/1/0/5/0, tips 42/2/0/6/0,
hooks 43/3/0/7/5, tips+hooks 43/1/1/10/3, generic 47/3/2/7/0, tuned 41/4/0/6/2. Muse Spark also
labelled each failure, but its "broke other tests" label is unreliable (65 of 67 uses were on runs
where every PASS_TO_PASS test passed). If shown at all, present the rules as the facts and the Muse
Spark labels as a rough second view, with that caveat.

**Static charts already exist** in `reports/` (`solved_per_arm.png`, `difference_vs_none.png`,
`cost_per_solved.png`, `test_vs_fresh.png`). Use them as visual references or a fallback, but the
page should draw its own interactive versions.

---

## 5. Page design (recommended: one long scrolling page)

Order matters: answer first, then evidence, then trust, then method.

### Section 1: Hero
- Title: "Uplift". Question as subtitle: "Does your coding-agent setup actually help on *your*
  codebase?"
- One-sentence answer: "We ran Muse Code 924 times on 77 real sqlglot bugs. No setup measurably beat
  no setup, and here's how we know."
- 4 stat tiles: **924** runs · **77** real bugs · **6** setups · **$21.31** total.
- Line: "Built for the Meta Global AI Developer Hackathon · Indie track · Push the Frontier · Meta
  models only: Muse Code (agent under test), Muse Spark (setup generator)."
- Jump links to the sections.

### Section 2: Headline result (required: "solved per arm with paired stats and error bars, cost per solved bug, regressions")
- **Main chart: dot-and-interval plot of `diff_vs_none`** with `ci_low`..`ci_high`, one row per arm,
  a bold vertical zero line labelled "No setup (72.7%)". X axis in percentage points (about −10 to
  +10). Don't use bar charts of raw rates: 72% vs 73% bars invite false readings.
- Shade the band ±5.4 to ±9.1 lightly or annotate it: "differences smaller than this could not be
  reliably detected".
- Next to it, a compact table: arm, solved (x/154), rate, cost per solved, regressions, tasks
  won/lost. Highlight (don't celebrate) that the generic copied file is lowest, costliest and has
  the most regressions.
- One plain-English takeaway box: "No setup was shown to differ from no setup. The generic copied
  tips file came out lowest. Smaller real effects (under ~5-9 points) can't be ruled out."

### Section 3: Where a difference could show (the signature visual)
- **Grid: 77 rows (tasks) × 6 columns (arms).** Cell = 0, 1 or 2 solved (use 3 shades plus a glyph
  or number). Group rows into three bands with counts: "Always solved (43)", "Mixed (23)",
  "Never solved (11)". Within bands, sort by total solved.
- Mark test vs fresh per row (small tag).
- Caption: "Only the 23 mixed bugs can tell setups apart. The agent is strong enough that most bugs
  are always or never solved."
- Clicking a row (or cell) opens that task in the explorer (section 4).
- Filters: set (all/test/fresh), band, "hooks fired".

### Section 4: Bug explorer (required: "one worked example: bug, agent diff, hook message, pass/fail")
- Layout: task header (title, set tag, GitHub link for test tasks), the issue rendered as markdown
  (collapsed past ~15 lines), then 6 arm cards, each showing its 2 runs: ✓/✗ resolved, cost, hook
  messages (styled as a terminal or callout, monospace), and the diff in a collapsible viewer with
  +/− line colouring.
- Optional: compare any two runs side by side.
- **Default/featured task: `tobymao__sqlglot-fresh-63296846`**, "Sqlite ParseError ... for WINDOW"
  (a fresh 2026 bug). No setup failed both runs; Tips + hooks solved both. Its hooks fired a co-change
  warning ("you edited sqlglot/parser.py but not sqlglot/generator.py ...") and a ruff format
  reminder, and the agent solved it with a parser-only change anyway. That makes it a good honest
  example: show it as "what a run looks like", **not** as proof that hooks caused the fix (one task,
  two runs, and the agent didn't follow the warning). Other mixed tasks with hooks and short diffs:
  `tobymao__sqlglot-4415`, `tobymao__sqlglot-4652`, `tobymao__sqlglot-fresh-6b9cb87b`.
- Before you feature a task, check it isn't one of the web-exposed runs (that list isn't in
  `results.json`; ask the team or run `uplift web-audit`). If you can't check, add a footnote.

### Section 5: Why you can trust the numbers (required)
- The 6 `trust` cards, with the title change from 2.1. Card 5 expands to the web-leak tables in
  section 4 above. Other good expand-for-detail facts:
  - The grader's 3 hidden-failure formats were real bugs caught in development (stale bytecode,
    pytest `SUBFAILED` sub-tests read as passes, multi-line `SUBFAILED`): see `PHASE_LOG.md`.
  - The proxy enforces a hard spending cap and allows only Meta models.
  - Some benchmark tasks need tests for changes the issue never describes; Muse Spark screened them
    with a rule fixed before any results were seen (dropped 4 of 120 tasks, excluded 38 of 164
    F2P tests), with no overrides.
- One "found it ourselves" line: "Our snapshot checks couldn't see the web. We found the gap
  ourselves, audited every tool call, and showed the result holds without the exposed runs."

### Section 6: How it works
A 5-step pipeline diagram (horizontal on desktop, vertical on mobile):
1. **Mine bugs:** past bug fixes become tasks (tests fail before the fix, pass after). Test set from
   SWE-rebench; fresh 2026 set mined by Uplift.
2. **Split by date:** the setup only sees the repo as it was before the test period, and a leakage
   check proves no test fix is in that snapshot.
3. **Map risk:** a placement map from git history (fix frequency, churn, SZZ bug-introducers,
   co-change rules) shows where checks belong.
4. **Generate setups:** Muse Spark writes the tips file and hook spec; Uplift renders the hooks.
5. **Run and grade:** Muse Code runs every task × setup × 2 repeats in a clean workspace (no git
   history, repo's own agent files removed). Only the repo's real tests grade: FAIL_TO_PASS must
   pass and PASS_TO_PASS must still pass. Paired bootstrap stats (10,000 resamples, seed 20261101).

### Section 7: What we built vs what we used (required)
- **Built (during the event):** budget guard, task loader/split, leakage checks, fresh-task miner,
  validator, fail-closed grader, risk map, setup generator, arms and hooks, batch runner, analysis
  and report, and this results page (credit the teammate by name; the team adds it).
- **Used:** sqlglot (MIT, the test repo), SWE-rebench tasks, Muse Code, Muse Spark.

### Section 8: Limitations (required, honest)
Use the list in `SUBMISSION.md` ("Limitations to state honestly") as-is, shortened to one line each.
At minimum: one repo and one agent; ceiling effect (only ~23 tasks discriminate); 40-step budget,
with the verify hook arriving late; "seeds" are repeats; tuned arm is a hypothesis; web access
(80 of 924 runs, result holds); no multiplicity adjustment; intervals move by up to 0.65 points with
the bootstrap seed.

### Section 9: Future work
Repos with little history (borrow from similar same-stack projects, synthetic bugs, live measurement
on real agent PRs); adapters for other agents (Claude Code, Codex); more repos.

### Footer
Repo link (`https://github.com/EshanGoel07/uplift`, verify it's public before linking), data
credits (sqlglot MIT, SWE-rebench; see `NOTICE.md`), "Demonstrated on sqlglot; the method is
repo-independent", and a link to `data/results.json` ("download the raw data").

---

## 6. Recommended implementation

- **Stack:** plain HTML + CSS + vanilla JS (ES modules), charts as hand-built SVG or a small library
  (Observable Plot, or D3 for the grid). No build step needed. A light framework (Vite, plus
  Svelte or React) is fine if the builder prefers, but it must output static files.
- **Files** (suggested):
  ```
  site/
    index.html
    css/style.css
    js/main.js          # load data, render sections
    js/charts.js        # interval plot, grid
    js/explorer.js      # task view, diff renderer
    data/results.json   # generated: don't hand-edit
    data/summary.json   # optional: generated light file
    data/tasks/<id>.json  # optional: per-task diffs, lazy-loaded
  ```
- **Data loading:** simplest is to fetch `results.json` once (about 400 KB gzipped on most hosts)
  and show a skeleton until it arrives. Better: a small script (for example
  `scripts/split_site_data.py`, run locally, free) writes `summary.json` (summary, arms, trust, and
  per-task id/set/title/solved counts/hook-fired flag, under 50 KB) plus one `tasks/<id>.json` per
  task with the issue and runs, fetched when a task opens. Keep `results.json` as the source of
  truth and regenerate from it.
- **Rendering untrusted text:** issue text and diffs come from GitHub and an AI agent. Render diffs
  as text (`textContent`), never `innerHTML`. If you render issue markdown, sanitise it (for example
  marked + DOMPurify) and don't load remote images from it.
- **Number formatting:** rates as `72.7%`; differences as signed points (`+0.6`, `−3.2`, with a true
  minus sign); money as `$0.031`; intervals as `−5.8 to +4.5`.
- **Colour:** a neutral palette. "No setup" in grey as the baseline; one accent for the other arms
  (they're not winners and losers, so avoid red/green for arms). Use green/red only for
  resolved/failed runs, always with ✓/✗. Must work in light and dark mode.
- **Deploy:** GitHub Pages from `/site` (or Vercel static). Test locally with
  `python -m http.server -d site 8000`, since `fetch` doesn't work over `file://`.

---

## 7. Acceptance checklist

- [ ] Hero states the null result in one sentence and names only Muse Code and Muse Spark.
- [ ] Headline interval plot uses `diff_vs_none`/`ci_low`/`ci_high`, zero line, no bar chart of raw rates.
- [ ] Cost per solved and regressions are shown per arm; total cost and $0.023 per run appear.
- [ ] Smallest detectable effect (5.4 to 9.1 points) appears near the headline chart.
- [ ] Grid shows 43 / 23 / 11 bands, computed from data.
- [ ] Explorer shows issue, diff, hook messages and ✓/✗ for every run; opens on a featured task.
- [ ] Trust card reads "We caught and measured web leaks" with 80 of 924 runs and the "result holds" table.
- [ ] "Built vs used", limitations, future work and the sqlglot caveat are present.
- [ ] Works from a sub-path, on mobile, by keyboard, in light and dark mode; diffs never injected as HTML.
- [ ] No numbers on the page contradict `results.json` or `reports/main.md`.
