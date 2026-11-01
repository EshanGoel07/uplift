# Uplift

**Does your coding-agent setup actually help on *your* codebase?** Uplift turns a
repo's own past bug fixes into test-graded tasks, generates a repo-specific agent
setup (checks first, instructions last) with Meta's Muse Spark, runs Meta's Muse
Code agent on every task with and without it, and keeps only what earns its place.

> Status: in development for the Meta Global AI Developer Hackathon (Oct–Nov 2026).

## Pipeline

1. `uplift tasks load`: pre-validated bug-fix tasks (tests fail before the fix, pass after).
2. `uplift tasks split`: newest tasks are the **test** set; older ones are **dev**. The
   setup may only be built from the repo as it was before the test period, and a
   leakage check proves no test-period fix is in that snapshot.
3. `uplift risk`: a placement map from git history (fix frequency, churn, SZZ
   bug-introducers, co-change rules), showing where checks belong.
4. *(next)* `uplift generate`, `uplift run`, `uplift diagnose`, `uplift report`.

## Quick start

```bash
uv venv -p 3.12 && source .venv/bin/activate && uv pip install -e ".[dev]"
git clone https://github.com/tobymao/sqlglot ../sqlglot
uplift tasks load  --repo tobymao/sqlglot
uplift tasks split --repo tobymao/sqlglot --clone ../sqlglot
uplift risk        --repo tobymao/sqlglot --clone ../sqlglot
```

## Notes for Muse developers

Observed with Muse Code 1.4.14 (1.4.14-R7309.1) across 1,228 `muse exec` runs on sqlglot tasks
(main runs: `--trust-workspace --disable-approval --max-model-steps 40`, default `--sandbox-network`).
We checked Meta's docs first and phrase these as observations; corrections welcome.

1. **A mis-shaped `.muse/hooks.json` is ignored without a warning.** With events at the top level
   instead of under `"hooks"`, no hooks fired (0 events vs 16 with the nested shape, same binary and
   prompt; reproduced live on 2026-11-02), and neither stderr nor the JSONL stream showed a warning.
   The docs say malformed hook files produce a startup warning. *Suggestion:* warn on unknown
   top-level keys in `hooks.json`. Reported via `/feedback`.
2. **Network access during evaluation can leak the answer.** In 80 of 924 main runs (8.7%, a lower
   bound; 78 of them passed) the agent reached the task's own upstream fix or newer upstream code:
   via `web_fetch` alone in 37 runs, via the shell (curl or Python urllib) alone in 30, and both in 13.
   With `--disable-approval`, outbound connections under the default `proxy-only` mode were not held
   for review; the docs don't say how `proxy-only` behaves when approval is bypassed.
   `--sandbox-network restricted` is documented, but we found the web-tool switches
   (`tools.web_fetch.enabled=false`, `tools.web_search.mode="off"`) only in the binary. Uplift now uses
   all three for new runs. *Suggestion:* document the web-tool switches and recommend this setup
   for benchmarks.
3. **A Stop-hook block on the final step is dropped silently.** In 8 runs a verify block landed on
   step 40 of 40, so there was no step left to deliver it; that part is expected. But Muse's JSONL
   stream has no hook events, so nothing in Muse's own output shows the block was lost.
   *Suggestion:* emit hook events (fired, blocked, delivered) in `--json` output.
4. **Reasoning shares the output budget.** On our Muse Spark judge calls, reasoning was 97–99% of
   completion tokens. At `max_tokens` 4,000 a call stopped with `finish_reason: length` and truncated,
   unparseable output. We use 8,000, retrying at 16,000 and 32,000. (This is documented; we list it
   as a practical tip.)

Only Meta models are called at runtime. See [NOTICE.md](NOTICE.md) for data credits.
