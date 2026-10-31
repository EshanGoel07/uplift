# Uplift: instructions for Claude Code

Uplift measures whether a coding-agent setup (AGENTS.md, hooks, checks) helps on a repo's own
past bugs. Read `README.md` and `PHASE_LOG.md` first. Built for the Meta Global AI Developer
Hackathon: **every model the project calls at runtime must be a Meta (Muse) model.**

## Money and secrets: hard rules

1. **Never read, print, copy or search for API keys.** They live in `~/.uplift-keys/`; you are
   denied access, and that's intended. Don't try to work around it (no Python `open()`, no `env`).
2. **The only way to spend credit is `scripts/paid.sh run-one ...`.** Never call `muse`,
   `guarded_muse.py`, `budget_proxy.py` or `uplift run-one` directly. The user approves every
   `paid.sh` call.
3. **Before a batch of paid runs,** check the budget: `curl -s http://127.0.0.1:8787/__budget`.
   Report `spent_usd` and `remaining_usd`. If `blocked` is true or under $5 remains, stop and tell
   the user. The proxy at :8787 is started by the user, not by you.
4. **Never** use `--yolo`, `--disable-sandbox` or `--set-spent`, edit `tools/budget_guard/`, or
   start/stop the proxy. Ask the user instead.
5. Only Meta models: never add code that calls a non-Muse model. The proxy also refuses them.

## Grading integrity (the result is only worth something if this holds)

- Tasks are graded only by the real tests: FAIL_TO_PASS must pass, PASS_TO_PASS must still pass.
  Never relax grading to make a run pass.
- If results look too good or too uniform (for example a task "valid" or "resolved" with no real
  change), stop and investigate. Two such bugs were already caught: stale bytecode, and pytest
  `SUBFAILED` sub-tests being read as passes. See PHASE_LOG.md.
- Test-set tasks (`.uplift/<repo>/split.json` `test_ids`) are for final reporting only.
  Develop and debug on `unused_ids` or `dev_ids`.
- Workspaces must not contain git history beyond the starting snapshot (no leakage).

## Workflow

- After any code change: `python -m pytest -q` must pass before reporting the work as done.
- Free commands you can run without asking: `pytest`, `uplift validate|tasks|risk`, `git status|diff|log`.
- Never commit or push. The user commits. When done, list changed files and suggest a commit message (style: `Phase <n>: <what>`).
- Update `PHASE_LOG.md` with findings, including bugs found and how they were caught.
- Keep runs reproducible: record task id, arm, seed, and cost in each run's `result.json` (already automatic).

## Layout

- `src/uplift/`: package (`tasks`, `split`, `risk`, `workspace`, `grade`, `runner`, `cli`)
- `tools/budget_guard/`: spend cap proxy + guarded Muse runner (don't edit without asking)
- `scripts/paid.sh`: the only paid entry point
- `.uplift/`: working data (git-ignored): tasks, split, risk map, workspaces, runs

## Submission

- Before any README, writeup or demo work, read `SUBMISSION.md` (official rules, what must appear, findings to remember).
- Never modify scripts/paid.sh, .claude/settings.json or tools/budget_guard/ with a shell or Python script; only with the Edit tool, so the user is asked.
