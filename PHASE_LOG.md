# Phase log

Built Oct 27 – Nov 4, 2026, for the Meta Global AI Developer Hackathon.

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

## Phase 2: setup generator, arms, hook probe (Oct 30)

- **Hook probe** (`paid.sh probe-hooks`, 2 tiny Muse Code runs, $0.018): Muse loads `.muse/hooks.json`
  only as `{"hooks": {<event>: [{"matcher"?, "hooks": [{"type": "command", "command", "timeout"}]}]}}`.
  A bare event map is silently ignored (first probe: no hook fired; found the "hooks must be an
  object" check in the binary). That also explains Phase 0's failed list-form variant.
  - (a) blocking works: a PreToolUse `hookSpecificOutput.permissionDecision: "deny"` stopped the command.
  - (b) feedback works both ways: PostToolUse `decision: "block"` + reason and `additionalContext` both
    reached the agent (it repeated both secret words).
  - Stop `decision: "block"` gives the agent another turn with the reason (2nd Stop had
    `stop_hook_active: true`; the reason was in the next model request), but can't force an action: the
    agent chose to follow the prompt's explicit "Stop." instead.
  - The environment is NOT passed to hooks, so hook logs live in the workspace (`.muse/uplift_hooks/`);
    the agent's sandbox keeps `.muse` read-only, so it can't edit hooks or their log.
  - Payload: Claude-style (`hook_event_name`, `tool_name`, `tool_input`, `tool_response`, ...). Tools seen:
    `bash`, `write_file`, and Muse's internal `submit_reminder_decision` (PostToolUse fires for it too).
- **Generator** (`paid.sh generate`; the key is never given to it, the proxy adds it): one Muse Spark
  call. Inputs: snapshot `e81789ee9a58` docs/tree, its last 150 commit subjects, the risk map, and 150
  review comments (2024-09-02..10-21) from 40 PRs merged by the cutoff; every item dated and checked
  (`assert_before`), saved under `.uplift/<repo>/generator/<run>/` (inputs, messages, response, spec, meta).
  First call ran out of tokens (3.5K of 4K were hidden reasoning); default is now 16K. Second call: $0.0011
  (prompt cached). Output: 13-line AGENTS.md citing review comments, 7 co-change rules (subset of the
  risk map's), ruff flags from the repo's own pre-commit config, extra source->test mappings.
- Hooks are rendered by Uplift, not written by the model, so their format is always valid: PostToolUse
  lint (ruff check + format check on files edited since the last call) and co-change warnings
  (`additionalContext`), Stop verify (related tests; `decision: block`, at most 2 blocks).
- Path check against the fresh snapshot `7660486c4cc6`: only `sqlglot/expressions.py` no longer exists
  (now a package); it appears in AGENTS.md, 3 co-change rules and a verify mapping. Reported, not fixed.
  (A first version of the check flagged short paths like `dialects/x.py`; it now also resolves `sqlglot/`.)
- Arms: none, prose, sensors, both, handwritten (`arms/handwritten/AGENTS.md`: a generic best-practice
  file, written by us in the style commonly shared online), and dev-only ablations lint-only /
  cochange-only / verify-only. Before any arm is installed, the repo's own agent
  files are removed: sqlglot added CLAUDE.md (2026-02) and AGENTS.md (2026-03), so every fresh task
  would otherwise start with them and "none" would not be none. Arm files never count as the agent's patch.
- **Smoke test** (dev task sqlglot-4109, seed 1, one run per arm): none, prose, sensors, both,
  handwritten, lint-only and cochange-only all resolved, $0.025-0.034 each ($0.214 for 7). Hooks fired in
  real runs: sensors lint 1/56, co-change 1/56, verify ran 1x (passed, no block); lint-only 0/62;
  cochange-only 1/61. verify-only was stopped ~2 min in (on an instruction I later corrected) and must
  be re-run.
- Two runs were slow, not hung: cochange-only 1,466 s and handwritten 1,735 s (others ~190-230 s). Almost
  all of it was waiting on the model API: in cochange-only one request got no reply, Muse re-sent the
  identical request and the reply came 1,265 s after the previous one; handwritten (no hooks at all) had
  a single 919 s wait. Not the hooks. A run dir with only prompt.txt mid-run is normal: the guard writes
  stdout.jsonl / guard_summary.json when the run ends.
- `run-one --timeout` now defaults to 2,400 s (40 min). The guard kills Muse at the timeout and still
  settles the real cost (exit 124); the runner records that as an error and never grades it. Backstop:
  the whole process group is hard-killed 180 s later if the guard itself doesn't exit.
- Stopping verify-only killed the guard before it settled, leaving a stale $0.87 reservation on the
  proxy (`reserved_usd`) and ~2 min of model calls unmetered (likely ~$0.01). The proxy is the user's;
  only they release it.
- runs/paid.log: every `run-one --task t1 --seed 2` / `generate --repo o/r` / bare `probe-hooks` line
  (since 2026-10-28) was written by tests/test_paid_sh.py, which ran the real script against a throwaway
  proxy and a fake `uplift` (no spend; no matching proxy ledger rows). Those lines are left in place.
  paid.sh now honours UPLIFT_PAID_LOG_DIR and the tests use a temp dir; a test checks the real log is
  untouched. The real Phase 2 calls were logged all along: probe-hooks 19:50:34Z ($0.007633),
  probe-hooks --wrapped 19:58:55Z ($0.010448), generate 20:02:39Z ($0.004068, ran out of tokens),
  generate 20:06:36Z ($0.001114), each matched to a proxy ledger row.
- verify-only re-run (sqlglot-4109, seed 1): resolved, $0.033193, 209 s, no API stall (72 model
  requests, no re-sends, longest gap between responses 21 s). The verify hook ran once at Stop (5
  related test files) and did not fire: the tests passed, so no block. All 8 smoke arms now resolved
  this task; Phase 2 smoke total $0.247 for 8 runs (plus the stopped partial run, unmetered).

## Phase 3: paid batch runner and pilot (Oct 30)

- `uplift plan-batch` + `uplift run-batch` (paid: `paid.sh run-batch`, one approval per batch, one
  --max-usd of at most $20). Plans list runs task by task, so a batch stopped early leaves whole tasks
  to compare; ablation arms are refused on non-dev tasks at plan time and again at run time; tasks not
  validated are left out. A run with a result.json is skipped, including an errored one (delete its
  folder to retry). Workspaces are deleted and stderr_trace.log / stdout.jsonl gzipped after each run;
  `<plan>.summary.json` is the status file. --max-usd is checked before each run starts, against spend
  settled so far, so a batch can pass it by up to `workers` runs. It applies per invocation.
- Runner: a non-zero agent exit is now an ungraded error (it used to be graded), and a proxy-unreachable
  exit (4) leaves no result.json and stops the batch (it used to be graded as an ordinary failure,
  with an empty patch). `MUSE_NO_AUTO_UPDATE=1` for agent runs: the launcher otherwise updates the
  binary in the background, hourly, so one batch could span two Muse versions.
- Pilot (dev 3987 and 3994 × 8 arms, 8 workers): 773 s wall, 16/16 finished, 0 errors, $0.550 (sum of
  result.json costs matches the proxy's delta). Runs took 260-404 s, mean 336 s, about 1.6x the smoke
  runs' usual ~200 s; no stall. Load peaked at 2.5 on 10 cores, no swap. A text search of the traces found no
  rate-limit errors; the only hit was the words "429 chars truncated".
- **0/16 resolved, in every arm: not a grading bug.** Each run failed exactly the F2P test(s) shown in
  its grade log and 0 PASS_TO_PASS tests. 14 of 16 runs passed the F2P test for the issue; all 16 failed
  a second F2P test for behaviour outside the issue text (3994: ClickHouse `CREATE SCHEMA ... ON CLUSTER`,
  for an issue about DuckDB-to-Spark TABLESAMPLE; 3987: Spark `INSERT OVERWRITE TABLE a TABLE b`, for an
  issue about MySQL JSON_VALUE). The dataset's F2P comes from the whole fix commit, so some tasks ask
  for more than the statement says. No arm can gain on such a task (a floor), which would dilute any
  difference between arms. How common this is across the 38 dev tasks is not known yet.

## Phase 4: main-batch prep (Oct 31)

- **Exit-1 runs:** the 5 dev errors (both 4110/4127/4293, sensors 4110, verify-only 4104) all ended with
  `run ended with Failed: model did not reach a terminal state within 40 step(s)`. The verify Stop hook
  blocked at step 33-39 and the agent used up its steps responding. Phase 3 had made every non-zero exit an
  ungraded error, which hid finished work in hook arms only. Now a non-zero exit with a patch is graded
  (`agent_exit`, `agent_end` recorded); errors are timeout, guard failure, killed or never started, no patch.
  `uplift regrade` applied the 5 patches to fresh workspaces: 4 resolved, verify-only 4104 failed 3 F2P tests.
- **Bias this removes:** `both` went from 19 to 22 solved and its 3 "losses" vs none disappeared. They were
  these error runs, so the Oct 31 "co-change hurts" reading was partly an artefact.
- **The step cap binds in every arm (not changed):** Muse adds a `<step-budget>` reminder from step 30 of 40
  telling the agent to wind down, and 284 of 304 dev runs reached it (none 37/38). The working budget is
  about 30 steps. Found while reading the traces for the exit-1 runs. The main plan keeps 40, as dev did.
- **Screening** (`paid.sh screen`, 164 Muse Spark calls, $0.067): the prompt holds only the issue and the
  lines the fix added to that test. Lines are found by rebuilding the patched test file and using `ast`
  spans, so a hunk spanning two tests doesn't mix them; all 164 tests had added lines of their own. The rule
  was fixed first. dev keeps 39/40 tasks (23/66 tests excluded), test 39/40 (12/53), fresh 38/40 (3/45).
  Dropped: 4040, 4516, fresh-06eb0510, fresh-d6d174e8. 4516 looks like a false "no": its only F2P test
  round-trips FLOAT(8), and the real fix is the REAL(8) one the issue reports. Kept dropped; no overrides.
- Screened grading runs the same tests. `grade` keeps the raw result, `resolved` ignores excluded tests.
  Plans record screened.json's hash and run-batch refuses a changed file.
- **Dev on the screened lists** (37 tasks, 1 seed), solved and wins/losses vs none: none 26; prose 24 +1/-3;
  sensors 26 +4/-4; both 24 +1/-3; handwritten 28 +3/-1; lint-only 27 +2/-1; cochange-only 21 +1/-6;
  verify-only 28 +4/-2. Note both's -3 here are other tasks (3987, 4302, 4328), with no co-change warning.
- **Co-change:** of cochange-only's 4 unscreened losses, 2 got no warning, 1 followed it and failed, 1 ignored
  it and failed. On screened dev, warned runs solved 13/20 (none 14/20 on those tasks), unwarned 8/17 (none
  12/17). Suggested files were edited in about 28% of warnings. No evidence the warnings hurt.
- **Tuned arm** (`paid.sh tune`, 1 call, $0.0014): dev inputs only, `assert_dev_only` refuses any test or
  fresh id, and a plan with non-dev tasks is refused. Output: 11-line AGENTS.md, lint and verify kept with
  new wording, co-change dropped. Muse Spark's stated reasoning is one-seed differences, so treat it as a
  hypothesis for the test set. The tuned arm has not had a real Muse Code smoke run.
- Hook script: optional `wording` in config.json; other arms' installed copies are unchanged and their
  behaviour is the same without it. `*.egg-info/` joined the workspace excludes (found by a new test: a repo
  with no .gitignore would have the build artefact counted in the agent's patch; sqlglot's patches had none).
- Licences checked: SWE-rebench CC-BY-4.0 (dataset card), sqlglot MIT (its LICENSE). NOTICE.md no longer
  lists Docker images, which Uplift never used, and states our changes to the data, as CC-BY asks.
- Main plan: 77 screened tasks (39 test, 38 fresh) × 6 arms × 2 seeds = 924 runs, `plans/main.json`.
- Bug, main batch: all 456 fresh runs crashed in `install_arm` before the agent started (`pathspec 'CLAUDE.md'
  did not match any files`); the 468 test runs were unaffected and were not touched. Cause: `workspace.create`
  commits with `git add -A`, which honours the machine's global gitignore. `~/.gitignore_global` lists
  CLAUDE.md, so it stayed untracked in the start commit, and staging its removal failed. No unit test caught it
  because the existing test force-added the file. `install_arm` now stages only paths git tracks, and strips
  symlinks with `lexists` (sqlglot's CLAUDE.md is a symlink to AGENTS.md, so a dangling one would have stayed).
  Tests cover tracked and untracked snapshots for the none and prose arms. The crashed dirs are in
  `runs_crashed_20261031/`; the smoke run (none, seed 1, resolved, $0.02, neither file in the workspace or its
  trace) is in `runs_smoke_20261031/`, because `run-one` writes to the batch path but does not apply screening.
  Other global-ignore entries (PLAN.md, .claude/, .cursor/, .aider*) still stay out of the start commit and the
  patch, so a batch on another machine could differ slightly; the agent paths among them are stripped anyway.

## Phase 5: analysis and exports (Nov 1)

- **Web leak (the main finding), caught while looking for how to detect "never ran tests":** a request listed `muse.web_fetch`
  calls. Workspaces have no git history, but Muse Code has web tools and its shell has network access, and nothing blocked
  them, e.g. `curl -sL https://github.com/tobymao/sqlglot/pull/4347.diff` returned the real fix during a run on task 4347.
  The snapshot leakage checks can't see this. `uplift web-audit` reads every tool call in every trace and gives each run
  its worst tier. Main batch: 59 own fix diff, 21 newer upstream code, 7 own PR page, 16 another PR or issue, 821 docs or no
  web. So 80 of 924 runs (8.7%) were exposed and 78 of them solved, against 572 of 821 clean (partly easy tasks). Exposed runs
  per arm: none 13, prose 12, sensors 16, both 12, handwritten 15, tuned 12. Test 73 of 468, fresh 7 of 456. Dev 69 of 304, so
  the tuned arm learned from leaked runs too. A lower bound (URLs built at run time and search snippets are not seen).
- **The result survives:** without the 26 affected tasks (51 left), also without own-PR-page tasks (50 left), and with exposed
  runs counted as failed, every arm's interval still crosses 0. Not fixed: no paid run was repeated. Any new batch should block
  the network. The trust card no longer says the fix can't be looked up.
- **hooks.jsonl is not what the agent received.** It logs quiet evaluations too (a not-fired line's detail is `ran: <tests>` or
  file names), cuts detail at 2,000 characters (28 of 50 verify messages), and joins findings with `\n` where the agent gets
  `\n\n`. results.json now takes messages from the model's requests, developer messages only: Muse's reminder side-calls quote
  the transcript in a user message, and after a Stop block Muse appends its own reminders to the same message.
- **6 verify blocks never reached the agent** (both 3, tuned 3): the Stop hook fired on the last step and the run ended at the
  step limit. Logged as fired, left out of results.json. Found by comparing hooks.jsonl with the traces.
- **Ledger:** the proxy's `model` column names the run folder, so cost matches run by run, and the sum ($21.306346) equals the
  result.json costs. The fresh-8e5e2557 smoke run wrote to the same path before the batch, so a path match alone would add its
  $0.0206; the batch's row is the last one. The ledger's whole-file sum ($30.65) is above spent ($29.78) by a $0.87 row from a
  Phase 0 run that was charged worst case; not a main-batch cost.
- **CIs differ from the Oct 31 figures** by one lattice step (0.65 points) in places. Those came from another seed; across seeds
  the bounds move by at most that step and no conclusion changes. SUBMISSION.md updated. It also said 5-7 points "could have
  been detected", which is the CI half-width, i.e. about 50% power; at 80% power it is 5.4-9.1 points.
- An audit false alarm worth keeping: 360 runs seemed to have a statement that differed from prompt.txt. `read_text` had folded
  `\r\n`; byte for byte, all 924 match.
- matplotlib added as the `report` extra (only `uplift report` imports it). The report is deterministic: identical bytes over
  two runs. `paid.sh label` added, plus a deny line for direct `uplift label`.
- **Failure labels** (`paid.sh label`, 258 failed runs, $0.47 against an estimate of $0.20): hidden reasoning used up the tokens
  on many calls, 84 extra requests in all, and 7 runs came back empty even at 16K, so a third try at 32K was added. The prompt has only
  the issue, the fix's file list and the diff. Agreement: "wrong file" matches the rule well, but Muse Spark's "broke other
  tests" is unreliable, because nearly all its uses are on runs where every PASS_TO_PASS test passed. The rules are the facts.

## Phase 6: network block (Nov 2)

- **Agent runs are cut off from the web.** `muse exec` gets `--sandbox-network restricted`, `tools.web_fetch.enabled=false` and
  `tools.web_search.mode="off"`, for run-one and run-batch, and result.json records `"network": "blocked"`. Muse's default,
  proxy-only, is why `curl github.com` worked. Found in the binary's strings (the rules forbid running `muse`); a web search did not
  turn up Meta's own docs for these. sandbox-exec was rejected: it can't allow one remote host, and it can't reach tools that run in Muse or at the provider.
- **The model API is not the proxy.** Muse calls api.meta.ai itself; the proxy only sees the guard's reserve and settle, which run
  outside the block. So the agent's tools reach nothing, proxy included, and the Muse process alone reaches the model API.
- **Probe** (`paid.sh probe-network`, $0.008484, control 200 from outside): `curl: (6) Could not resolve host: github.com`; the same
  curl with `require_escalated`, added because approval-free runs might have allowed it: `tool failed: launch policy forbids
  unsandboxed execution`; web_fetch and web_search not among the 34 tools offered, so step (b) was never callable; agent replied done.
- **Bug caught by the probe:** the audit counted that refusal as a fetch of the fix (`own_fix`), so the first verdict was a fail.
  It now knows `tool failed:` and `Could not resolve host`; the verdict was re-scored from the saved trace, no second paid run. A
  first fix also treated empty output as failed; comparing with the cached audits moved one dev run (4014), which really did fetch
  upstream code and print nothing, and `curl -o` then `cat` would have hidden the same way. Reverted. Final: 0 of 924 main and 0 of
  304 dev tiers change. The cost: a blocked `curl -s | head` still reads as exposed, the safe direction.
- **Still open:** the sandbox leaves the filesystem readable, so an agent could read the full-history clone at `--clone`. 0 of 1,220
  saved traces name it, but nothing blocks it. Blocked runs also can't `pip install` missing test dependencies, and past agents
  sometimes tried, so new runs should not be pooled with the 924.

## Phase 7: public-repo prep (Nov 3)

- README rewritten for judges; Apache-2.0 `LICENSE` added. Internal submission notes moved to the
  git-ignored `.private/` (they stay in earlier commits; history is kept as is).
- **Bug avoided:** `uplift report` read its Limitations list from the notes file, so moving it would
  have broken the report. It now reads the README's `## Limitations` section (`--limits-from`). Regenerated
  from saved results with no model calls: every number and chart identical; only the limitations text changed.
- The handwritten arm's label was "Generic copied tips file", which implied copying. It is a generic
  best-practice file written by us in the style commonly shared online; label now "Generic tips file",
  and `results.json` arms carry a one-line `description`. Re-exported and re-reported: numbers unchanged.
- Worked example for the README and video: fresh-63296846 (`SELECT 1 WINDOW a AS (...)`), web-clean in all
  12 runs. 7 runs took a one-line shortcut that broke `window` as a plain alias (all failed on that
  assertion, per `grade_pytest.txt`); 4 used a look-ahead and passed. Tips + hooks 2/2 vs none 0/2, but the
  hook messages were generic co-change warnings that the failed hooks-only runs also got: approach choice,
  not setup, decided it.
- Personal billing lines removed from `tools/budget_guard/SETUP.md`; NOTICE.md now says the SWE-rebench
  issue texts in `results.json` are included under CC-BY-4.0.
