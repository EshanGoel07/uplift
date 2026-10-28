"""`uplift` command line.

    uplift tasks load  --repo tobymao/sqlglot
    uplift tasks split --repo tobymao/sqlglot --clone ../sqlglot
    uplift risk        --repo tobymao/sqlglot --clone ../sqlglot

Working data lives in .uplift/<owner>__<name>/ (git-ignored).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import risk as risk_mod
from . import split as split_mod
from . import tasks as tasks_mod


def repo_dir(workdir: Path, repo: str) -> Path:
    return workdir / repo.replace("/", "__")


def cmd_tasks_load(a) -> int:
    out = repo_dir(a.workdir, a.repo) / "tasks.jsonl"
    files = [Path(p) for p in a.parquet] if a.parquet else \
        [tasks_mod.download(tasks_mod.SWE_REBENCH_FILTERED, a.workdir / "cache")]
    tasks = tasks_mod.load_swe_rebench(a.repo, files)
    tasks_mod.save_tasks(tasks, out)
    years: dict[str, int] = {}
    for t in tasks:
        years[t.created_at[:4]] = years.get(t.created_at[:4], 0) + 1
    print(f"{len(tasks)} tasks for {a.repo} -> {out}")
    print("by year:", json.dumps(dict(sorted(years.items()))))
    return 0


def cmd_tasks_split(a) -> int:
    d = repo_dir(a.workdir, a.repo)
    tasks = tasks_mod.read_tasks(d / "tasks.jsonl")
    s = split_mod.make_split(tasks, test_n=a.test_n, dev_n=a.dev_n)
    s = split_mod.attach_snapshot(s, a.clone, margin_days=a.margin_days)
    s = split_mod.check_leakage(s, tasks, a.clone, a.workdir / "worktrees")
    s.save(d / "split.json")
    leaks = {k: v for k, v in s.leakage.items() if v}
    print(f"test: {len(s.test_ids)} tasks from {s.cutoff[:10]}; dev: {len(s.dev_ids)}; unused: {len(s.unused_ids)}")
    print(f"snapshot: {s.snapshot_commit[:12]} ({s.snapshot_date})")
    if leaks:
        print(f"LEAKAGE in {len(leaks)} test task(s):")
        for k, v in leaks.items():
            print(f"  {k}: {'; '.join(v)}")
        return 1
    print("leakage check: PASS (no test-period fix or test is present in the snapshot)")
    return 0


def cmd_risk(a) -> int:
    d = repo_dir(a.workdir, a.repo)
    s = split_mod.Split.load(d / "split.json")
    r = risk_mod.build_risk_map(a.clone, s.snapshot_commit, source_prefix=a.source_prefix,
                                test_prefix=a.test_prefix, szz_limit=a.szz)
    risk_mod.save(r, d / "risk.json")
    print(f"{r['commits_analysed']} commits ({r['fix_commits']} fixes) up to snapshot {r['snapshot'][:12]}")
    print("top risk files:")
    for f in r["files"][:10]:
        print(f"  {f['risk']:.2f}  {f['path']}  (fix weight {f['fix_weight']}, bug introducers {f['bug_introducers']})")
    print(f"{len(r['co_change_rules'])} co-change rules; tests mapped for {len(r['tests_for_source'])} source files")
    return 0


DEFAULT_GUARD = Path(__file__).resolve().parents[2] / "tools" / "budget_guard" / "guarded_muse.py"


def _task(a) -> "tasks_mod.Task":
    d = repo_dir(a.workdir, a.repo)
    by_id = {t.id: t for t in tasks_mod.read_tasks(d / "tasks.jsonl")}
    if a.task not in by_id:
        raise SystemExit(f"unknown task {a.task}")
    return by_id[a.task]


def cmd_validate(a) -> int:
    from . import runner
    t = _task(a)
    out = runner.validate(t, a.clone, a.workdir / "workspaces", repeats=a.repeats, python_version=a.python)
    d = repo_dir(a.workdir, a.repo) / "validation"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{t.id}.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out))
    return 0 if out["valid"] else 1


def cmd_run_one(a) -> int:
    from . import runner
    t = _task(a)
    setup = Path(a.setup) if a.setup else None
    arm = a.arm or (setup.name if setup else "baseline")
    run_dir = repo_dir(a.workdir, a.repo) / "runs" / arm / f"{t.id}-s{a.seed}"
    res = runner.attempt(t, a.clone, a.workdir / "workspaces", run_dir, arm=arm, setup_dir=setup,
                         seed=a.seed, guard=a.guard, max_steps=a.max_steps, timeout=a.timeout,
                         trust_usage=not a.strict_cost, python_version=a.python, agent_cmd=a.agent_cmd)
    g = res.grade or {}
    print(json.dumps({"task": t.id, "arm": arm, "resolved": res.resolved,
                      "f2p_failed": len(g.get("f2p_failed", [])), "regressions": len(g.get("p2p_failed", [])),
                      "cost_usd": res.cost_usd, "seconds": res.seconds, "agent_exit": res.agent_exit,
                      "error": res.error, "run_dir": str(run_dir)}))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="uplift", description=__doc__.split("\n\n")[0])
    ap.add_argument("--workdir", type=Path, default=Path(".uplift"))
    sub = ap.add_subparsers(dest="cmd", required=True)

    t = sub.add_parser("tasks", help="build and split test-graded tasks")
    tsub = t.add_subparsers(dest="tcmd", required=True)
    tl = tsub.add_parser("load", help="load pre-validated tasks from SWE-rebench")
    tl.add_argument("--repo", required=True)
    tl.add_argument("--parquet", nargs="*", help="local SWE-rebench parquet files (default: download)")
    tl.set_defaults(func=cmd_tasks_load)
    ts = tsub.add_parser("split", help="date split into dev/test + leakage check")
    ts.add_argument("--repo", required=True)
    ts.add_argument("--clone", type=Path, required=True, help="full-history clone of the repo")
    ts.add_argument("--test-n", type=int, default=40)
    ts.add_argument("--dev-n", type=int, default=40)
    ts.add_argument("--margin-days", type=int, default=1)
    ts.set_defaults(func=cmd_tasks_split)

    r = sub.add_parser("risk", help="risk / placement map from history before the snapshot")
    r.add_argument("--repo", required=True)
    r.add_argument("--clone", type=Path, required=True)
    r.add_argument("--source-prefix", default="")
    r.add_argument("--test-prefix", default="tests/")
    r.add_argument("--szz", type=int, default=200, help="newest N fix commits to blame (0 = off)")
    r.set_defaults(func=cmd_risk)

    v = sub.add_parser("validate", help="prove a task is real: fails before the fix, passes after (repeated)")
    v.add_argument("--repo", required=True)
    v.add_argument("--clone", type=Path, required=True)
    v.add_argument("--task", required=True)
    v.add_argument("--repeats", type=int, default=3)
    v.add_argument("--python", default="3.12")
    v.set_defaults(func=cmd_validate)

    o = sub.add_parser("run-one", help="one agent attempt on one task, graded by the real tests")
    o.add_argument("--repo", required=True)
    o.add_argument("--clone", type=Path, required=True)
    o.add_argument("--task", required=True)
    o.add_argument("--setup", help="folder with a setup to install (AGENTS.md, .muse/hooks.json, ...); omit for baseline")
    o.add_argument("--arm", help="name for this configuration (default: setup folder name or 'baseline')")
    o.add_argument("--seed", type=int, default=1)
    o.add_argument("--max-steps", type=int, default=40)
    o.add_argument("--timeout", type=int, default=1800)
    o.add_argument("--python", default="3.12")
    o.add_argument("--guard", type=Path, default=DEFAULT_GUARD)
    o.add_argument("--strict-cost", action="store_true", help="charge worst case instead of parsed cost")
    o.add_argument("--agent-cmd", help=argparse.SUPPRESS)  # tests only: replaces the agent
    o.set_defaults(func=cmd_run_one)

    a = ap.parse_args(argv)
    return a.func(a)


if __name__ == "__main__":
    sys.exit(main())
