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

    a = ap.parse_args(argv)
    return a.func(a)


if __name__ == "__main__":
    sys.exit(main())
