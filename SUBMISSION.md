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
3. "Why you can trust the numbers": 0/40 leakage with positive controls, fresh 2026 bugs, dev/test split, fail-closed grader (3 hidden-failure formats caught), no git history in workspaces, repo's own CLAUDE.md/AGENTS.md stripped, every call metered.
4. Headline chart: solved per arm with paired stats and error bars, cost per solved bug, regressions.
5. One worked example task (bug, agent diff, hook message, pass/fail).
6. Honest framing: claims no bigger than the evidence; state the smallest difference we could detect.
7. One repo caveat: "demonstrated on sqlglot; the method is repo-independent".
8. Future work: repos with little history (borrow from similar same-stack projects, synthetic bugs, live measurement on real agent PRs); adapters for other agents (Claude Code, Codex).
9. Cost line: total study cost and cost per run, e.g. "N agent runs on real bugs for $X".

## Findings to remember for the story

- Dev batch (Oct 31, 38 tasks x 8 arms x 1 seed, $7.52): no arm clearly beats none; co-change warnings may hurt (cochange-only +0/-4, both +0/-3 vs none); lint-only and verify-only neutral to slightly positive. Only 9 of 38 tasks differ between arms.
- Some benchmark tasks require tests for changes the issue never describes (bundled commits); screen them before the main batch, rule fixed before seeing arm results.
- The 2024-generated setup references sqlglot/expressions.py, which no longer exists in 2026: setups go stale (supports "re-test your setup").
- Muse hooks only load nested under "hooks"; blocking and feedback both work.
- sqlglot added its own CLAUDE.md (2026-02) and AGENTS.md (2026-03); stripped so "none" means none.

## Before submitting

- Make the repo public; README first lines as above; NOTICE.md credits sqlglot and SWE-rebench.
- Video <= 3 min, link in the form; every team member added.
- Friend's frontend only if organisers confirm (open question: can he be on two teams?); credit him if so.
