# Phase log

Built for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026).

## Phase 0: budget guard (Oct 27–28)

- `tools/budget_guard/`: a local proxy that hard-caps API spend, meters every call,
  and refuses any non-Meta model (hackathon rule: Meta models only at runtime).
  `guarded_muse.py` reserves each Muse Code run's worst-case cost before it starts.
- Tested against fake APIs: the cap is never exceeded, including under 40
  concurrent calls and 10 concurrent agent runs.

## Phase 1a: tasks, split, risk map (Oct 28–29)

- `uplift tasks load`: 294 pre-validated sqlglot tasks from SWE-rebench (each has
  `FAIL_TO_PASS` tests and a Docker image).
- `uplift tasks split`: the newest 40 tasks are the **test** set (from 2024-10-31),
  and the 40 before them are **dev**. The snapshot the setup may learn from is
  `e81789ee9a58` (2024-10-30).
- **Leakage check:** 0/40 test fixes are present in the snapshot. Positive
  control: 22/40 *dev* fixes are detected as present, so the check really fires.
  It initially reported 0/40 for both because of a relative-path bug, which the
  control caught.
- `uplift risk`: 4,670 commits (1,776 fixes) before the snapshot, SZZ-lite over
  the newest 200 fixes, 24 co-change rules, and a source→test mapping for 27 files.
- **Held-out check of the risk map:** 70 of the 80 source files changed by
  test-period fixes (88%) were in the map's top-20% risk set. Caveat: sqlglot's
  changes concentrate in a few core files; compare against an edit-count baseline
  before claiming this.

## Phase 1b: one-task runner and validator (Oct 29)

- Phase 0 results on the real Mac: `muse exec` runs on `muse-spark-1.3-contributor`; the
  guard reads Muse Code's real usage (Responses API format), so a trivial run costs
  ~$0.005–0.008; `--trust-workspace` loads project rules and hooks with the sandbox still
  on; the `.muse/hooks.json` format is an object keyed by event (SessionStart and
  PostToolUse confirmed).
- `uplift validate`: a task is valid only if, on every repeat, a FAIL_TO_PASS test fails
  before the real fix and all FAIL_TO_PASS + PASS_TO_PASS tests pass after it.
- `uplift run-one`: one Muse Code attempt (through the budget guard), graded by the
  hidden tests. Task workspaces contain only the starting snapshot, with **no git
  history**, so the agent can't look up the future fix. Test files are reset before
  grading, so edited tests can't fake a pass.
- Caught in testing: stale Python bytecode can make a same-size edit run the old code,
  so grading now clears `__pycache__` and disables bytecode writing.
- First paid run (sqlglot-3855, baseline, seed 1): **resolved**, 0 regressions, $0.035,
  254 s; the agent's fix was one line in `sqlglot/dialects/mysql.py` (`%W` → `%A`).
- Caught in that run: `result.json` had `cost_usd: null` and an `agent.patch` of 987 lines.
  The CLI's run_dir is relative (`.uplift/...`) but the guard runs with cwd=workspace, so it
  wrote `guard_summary.json` and `stdout.jsonl` inside the workspace: cost was lost, the logs
  were counted as agent changes, and the agent could see its own trace mid-run. Grading was
  unaffected (real tests; the only source change was mysql.py). Fix: `attempt()` resolves
  run_dir and ws_root to absolute paths; guard log names are also in the workspace git
  excludes. A new test drives the guard path with a relative run_dir (fails before the fix).
