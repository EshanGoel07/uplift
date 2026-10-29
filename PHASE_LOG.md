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

## Phase 1c: validate-batch, fresh tasks, grading fix (Oct 29)

- `uplift validate-batch`: one `uplift validate` subprocess per task, N workers; skips finished
  results (crashed ones are retried), deletes workspaces, writes `validation/summary.json`.
  Raw pytest output for every repeat is now kept in `validation/logs/<id>/{before,after}-<i>.txt`.
- `uplift mine-fresh`: 40 fresh tasks from 1,201 commits since 2026-01-01 (2026-04-20 .. 10-28).
  Statement = the linked GitHub issue only. Fresh snapshot `7660486c4cc6` (2026-04-17): leakage
  0/40; positive control at HEAD detects 30/40. Original test snapshot re-checked: 0/40 (dev control 24/40).
- Caught: `gh issue view N` also answers for PR numbers and returns the PR body, which describes
  the fix. Now requires an `/issues/` URL.
- Caught: a fork's squashed PR said "Fixes #54" (the fork's issue); upstream #54 is an unrelated 2021
  issue, so the task got a wrong statement. The issue must now be closed by the commit's PR, or
  opened before and closed within [-1, +7] days of the commit. Found by eyeballing an outlier issue number.
- Caught: parallel per-commit `git fetch`es into the clone (PR-branch base commits) failed and crashed
  15 validations. validate-batch now fetches missing base commits sequentially first.
- **Grading bug caught (sqlglot-4505):** a sub-test labelled with multi-line SQL prints its id ~20
  lines below `SUBFAILED[`; the parser only looked on the first line, so the failure was dropped and
  the parent's `PASSED` won (pytest itself said `1 failed`). Fix: parse multi-line sub-test blocks,
  and fail closed: parsed FAILED+SUBFAILED / ERROR / PASSED counts must equal pytest's summary line,
  and a missing summary (crash/timeout) is an error; such a grade is never resolved. Found because
  the task came out "F2P already passing before the fix", contradicting the dataset.
  The paid 3855 run re-grades identically. 4172's P2P failure is not this bug: a DuckDB `(execute)`
  sub-test fails before and after the fix (newer DuckDB than the dataset's image).
- Caught: workspaces live under the uplift repo, so pytest's rootdir/ini discovery reached uplift's
  own `pyproject.toml` (`[tool.pytest.ini_options]`), and a probe showed a parent `conftest.py` would
  load too. Workspace pytest now runs with `--rootdir=<ws> -c <ws's own config or /dev/null>
  --confcutdir=<ws>`; a test puts a breaking config and conftest above a workspace.
- Known gap: the 3 commits dropped by the miner for "no FAIL_TO_PASS test" were measured with the
  old parser and were not re-checked. A missed before-fix sub-test failure could have hidden a real
  F2P test, so one of them might have qualified. That affects which 40 tasks were picked, not grading.
- Re-validation with the fixed parser (raw logs kept, 8 workers, sequential prefetch): test 40/40
  valid (3 repeats), fresh 39/40 (3 repeats), dev 38/40 (1 repeat). No fetch crashes. Validity
  recomputed offline from the 560 raw logs agrees with every stored result; every F2P test fails
  before the fix in every repeat.
- The fail-closed check caught a third sub-test format on its first real run: sub-tests labelled
  by keyword arguments print `SUBFAILED(sql='...') <id>` (parentheses). 4 fresh tasks were
  reported invalid (count mismatch, so no grade, never a false pass); parser now handles both forms.
- Invalid, all environment (newer DuckDB than the dataset's Docker image), each failing before AND
  after the real fix: dev 4004 and 4172 (`test_qualify_columns`, a DuckDB `(execute)` sub-test), and
  fresh-1dae76b5 (`test_optimized_tpch`, DuckDB "Deprecated lambda arrow"). For 1dae76b5 the old
  parser hid that multi-line sub-test failure, so the miner put the test in P2P; recomputing fresh
  F2P/P2P from the validation logs changes only this task (P2P minus that test).
- `uplift mine-fresh --recompute-from-logs` re-derives fresh F2P/P2P from the kept raw logs with the
  current parser. Run on all 40: only fresh-1dae76b5 changed (`test_optimized_tpch` out of P2P);
  re-validated 3/3, so fresh is now 40/40 valid.
