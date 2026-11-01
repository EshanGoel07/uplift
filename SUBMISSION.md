# Submission notes (Meta Global AI Developer Hackathon)

Read this before writing the README, the video script or the writeup. Plan doc: "Uplift: Hackathon Plan & Startup Link".

## Official rules (read Oct 31)

- **Deadline:** Wed Nov 4, 9:00 PM ET = Thu Nov 5, 6:30 AM IST. Aim to submit the evening of Nov 4 IST.
- **Submit at:** https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit
- **Needs:** public repo, working demo video link, every team member added. One person submits.
- **New work only:** everything presented must be built Oct 26 - Nov 4. Keep the git history as is (no squashing).
- **Identify contributions (disqualification if unclear):** the demo must show only what we built during the event.
- **Teams:** max 4, solo allowed, one track only (we are Indie Developer).
- **Demo video:** 3 minutes, required, one of the main scoring items.
- **Theme:** Push the Frontier (Muse Spark / Meta models on hard problems in software).
- **Banned:** code, data or assets without rights; generic project types (not us).

## Judging (FAQ, Oct 31)

- Gate first: fits the theme AND meaningfully uses the Meta Model API and/or Meta open-weight models.
- Then scored EQUALLY on four criteria: **Impact**, **Use of Meta AI tooling**, **Technical depth and execution**, **Demo quality**.
- Top 5 projects per track advance to the finals.
- Building on an existing project is allowed only if the demo clearly shows just what was built during the event.
- Also banned: anything political or involving war.

What each criterion needs from us:
- Impact: who benefits (teams paying for coding agents), what it changes (proof instead of guesswork, cost per solved bug, setups that hurt).
- Use of Meta AI tooling (decided Oct 31): four Muse Spark roles + Muse Code as the agent under test.
  1. Muse Spark screens tasks: does the issue describe each required test? Spot-check ~10 by hand, report agreement.
  2. Muse Spark generates the setups (done).
  3. Muse Spark diagnoses dev failures and writes the tuned setup.
  4. Muse Spark labels why failed runs failed, cross-checked with simple rules (Nov 1, cheap).
  Extra if feasible after the main analysis: a smaller Meta model (Muse Glimmer on Fireworks) as the agent, none vs tuned on ~40 tasks ("do setups help small models more?"). Check feasibility first (~3-4 h).
  Skip: SAM 3 / vision, Muse writing report text (decoration, not meaningful use).
- Technical depth: the trust section and the bugs we caught.
- Demo quality: the 3-minute video is a quarter of the score; plan it early (Nov 2).

## Must appear in the README and the video

1. First lines: track (Indie), problem statement (Push the Frontier), Meta models used (Muse Code = agent under test; Muse Spark = setup generator; no other models), built Oct 29 - Nov 4.
2. "What we built vs what we used":
   - Built: budget guard, task loader/split, leakage checks, fresh-task miner, validator, fail-closed grader, risk map, setup generator, arms and hooks, batch runner, analysis and report.
   - Used: sqlglot (MIT, test repo), SWE-rebench tasks (check licence), Muse Code, Muse Spark.
3. "Why you can trust the numbers": 0/40 snapshot leakage with positive controls, fresh 2026 bugs, dev/test split, fail-closed grader (3 hidden-failure formats caught), no git history in workspaces, repo's own CLAUDE.md/AGENTS.md stripped, every main-batch run metered. Must also state the web gap: 80 of 924 runs reached the fix or newer code, audited and shown not to change the result.
4. Headline chart: solved per arm with paired stats and error bars, cost per solved bug, regressions.
5. One worked example task (bug, agent diff, hook message, pass/fail).
6. Honest framing: claims no bigger than the evidence; state the smallest difference we could detect.
7. One repo caveat: "demonstrated on sqlglot; the method is repo-independent".
8. Future work: repos with little history (borrow from similar same-stack projects, synthetic bugs, live measurement on real agent PRs); adapters for other agents (Claude Code, Codex).
9. Cost line: total study cost and cost per run, e.g. "N agent runs on real bugs for $X".

## Findings to remember for the story

- WEB LEAK (found Nov 1 in Phase 5): workspaces have no git history, but Muse Code has web tools and shell network access, and nothing blocked them. `uplift web-audit`: 80 of 924 main runs (8.7%) reached the task's own fix or newer upstream code (59 own fix diff, 21 newer code; 78 solved), 12-16 per arm; test 73 of 468, fresh 7 of 456; dev 69 of 304. A lower bound. The main result survives: dropping the 26 affected tasks (51 left), or counting exposed runs as failed, still leaves every interval crossing 0. Never say the fix could not be looked up. Do say we found this ourselves and measured it.
- MAIN RESULT (Oct 31, 924 runs: 77 screened tasks = 39 test + 38 fresh, x 6 arms x 2 repeats, $10.08 + $11.22): solved none 72.7%, prose 72.7%, sensors 72.1%, both 72.1%, handwritten 69.5%, tuned 73.4%. Paired task-level bootstrap vs none (95% CI, 10,000 resamples, seed 20261101, `uplift report`): prose +0.0 [-5.8,+4.5], sensors -0.6 [-6.5,+4.5], both -0.6 [-7.1,+5.8], handwritten -3.2 [-9.1,+1.3], tuned +0.6 [-2.6,+4.5]. No arm significantly different from none. Smallest effect detectable with 80% power: 5.4-9.1 points (CI half-widths are 3.6-6.5, which is only ~50% power). Generic handwritten file is lowest, most expensive per solved bug ($0.034 vs $0.031) and has the most regression runs (2; both has 1, the others 0). 43/77 tasks solved in every run by every arm, 11 never: only ~23 tasks discriminate (ceiling effect with a strong agent). Test vs fresh similar (75.6% vs 69.7% for none). Total project spend $29.78 of $100.
- Dev batch (Oct 31, 38 tasks x 8 arms x 1 seed, $7.52): no arm clearly beats none. On the screened lists (37 tasks, one seed, solved / wins-losses vs none): none 26; prose 24 (+1/-3); sensors 26 (+4/-4); both 24 (+1/-3); handwritten 28 (+3/-1); lint-only 27 (+2/-1); cochange-only 21 (+1/-6); verify-only 28 (+4/-2). Only 12 of 37 tasks differ between arms.
- The early "co-change warnings hurt" reading did not hold: both's 3 losses were runs wrongly recorded as errors (solved once graded), and most of cochange-only's gap is in runs where no warning fired (with a warning: 13/20 vs none 14/20; without: 8/17 vs 12/17). Warnings look weak (followed ~28% of the time), not harmful.
- The 40-step cap binds: Muse starts its wind-down reminders at step 30 and 284 of 304 dev runs reached them, in every arm. A verify block at step 33-39 can run the agent out of steps (5 dev runs, exit 1, 4 of them solved anyway).
- Some benchmark tasks require tests for changes the issue never describes (bundled commits); screened before the main batch, rule fixed before seeing arm results. Muse Spark excluded 38 of 164 F2P tests and dropped 4 of 120 tasks. Spot-check: 9 of 10 looked right to Claude Code (4516 doubtful); the by-hand check is still to report.
- The 2024-generated setup references sqlglot/expressions.py, which no longer exists in 2026: setups go stale (supports "re-test your setup").
- Muse hooks only load nested under "hooks"; blocking and feedback both work.
- sqlglot added its own CLAUDE.md (2026-02) and AGENTS.md (2026-03); stripped so "none" means none.

## Limitations to state honestly (decided Oct 31)

- One repo (sqlglot) and one agent (Muse Code on muse-spark-1.3-contributor).
- 40-step agent budget for every arm (Muse wind-down starts at step 30); the verify hook arrives late in that budget.
- "Seeds" are repeats: the seed labels the run but isn't passed to Muse.
- Screening rule fixed before seeing results, no overrides: task 4516 was probably dropped wrongly and stays dropped.
- Ceiling effect: 43/77 tasks solved by every run of every arm, 11 by none; only ~23 tasks can show a difference.
- The tuned arm was chosen from one-seed dev differences: a hypothesis, not a proven improvement.
- Agents had web and shell network access: at least 80 of 924 runs reached the real fix or newer upstream code, 12-16 per arm and mostly on test tasks. Removing them doesn't change the conclusion, but solve rates are somewhat inflated, and test vs fresh is not a clean comparison.
- The 5 comparisons vs none are not adjusted for multiplicity, and the intervals move by up to one step (0.65 points) with the bootstrap seed.
- 6 verify blocks fired on the last step and never reached the agent.
- Global gitignore on the build machine keeps a few agent files (CLAUDE.md, .claude/, .cursor/) out of start commits; grading is unaffected.

## Before submitting

- Make the repo public; README first lines as above; NOTICE.md credits sqlglot and SWE-rebench.
- Video <= 3 min, link in the form; every team member added.
- Friend is on the team (Uplift is his only hackathon project; rules allow up to 4). Add him on the submission form, and list his part (results page / frontend) under "what we built" with his name. Everything he builds must be made during the event.
