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

Only Meta models are called at runtime. See [NOTICE.md](NOTICE.md) for data credits.
