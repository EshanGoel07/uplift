"""`uplift` command line.

    uplift tasks load  --repo tobymao/sqlglot
    uplift tasks split --repo tobymao/sqlglot --clone ../sqlglot
    uplift risk        --repo tobymao/sqlglot --clone ../sqlglot
    uplift mine-fresh  --repo tobymao/sqlglot --clone ../sqlglot --since 2026-01-01 --limit 40
    uplift validate-batch --repo tobymao/sqlglot --clone ../sqlglot --ids dev,test,fresh --workers 4
    uplift plan-batch --repo tobymao/sqlglot --clone ../sqlglot --ids dev --out plan.json
    scripts/paid.sh run-batch --plan plan.json --workers 8 --max-usd 2

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
    d = repo_dir(a.workdir, a.repo) / "validation"
    out = runner.validate(t, a.clone, a.workdir / "workspaces", repeats=a.repeats, python_version=a.python,
                          log_dir=d / "logs" / t.id)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{t.id}.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out))
    return 0 if out["valid"] else 1


def cmd_validate_batch(a) -> int:
    from . import batch
    d = repo_dir(a.workdir, a.repo)
    s = split_mod.Split.load(d / "split.json")
    names = [n.strip() for n in a.ids.split(",") if n.strip()]
    unknown = [n for n in names if n not in batch.LISTS]
    if unknown:
        raise SystemExit(f"unknown list(s) {unknown}; choose from {sorted(batch.LISTS)}")
    lists = {n: getattr(s, batch.LISTS[n]) for n in names}
    workdir, clone = a.workdir.resolve(), a.clone.resolve()
    # Base commits on PR branches need a fetch. Do it here, one at a time: parallel
    # `git fetch`es into the same clone fail on its locks and crash the workers.
    from . import gitutil
    by_id = {t.id: t for t in tasks_mod.read_tasks(d / "tasks.jsonl")}
    wanted = {i for ids in lists.values() for i in ids}
    missing = [i for i in sorted(wanted) if not gitutil.ensure_commit(clone, by_id[i].base_commit)]
    if missing:
        print(f"warning: base commit not fetchable for {len(missing)} task(s): {missing}")

    def one(tid):
        return batch.validate_subprocess(tid, repo=a.repo, clone=clone, workdir=workdir,
                                         repeats=a.repeats, python=a.python)

    summary = batch.run_batch(lists, out_dir=d / "validation", ws_root=workdir / "workspaces",
                              workers=a.workers, force=a.force, keep_workspaces=a.keep_workspaces,
                              validate_one=one)
    last = summary["last_run"]
    print(f"validated {len(last['validated'])}, skipped {len(last['skipped_existing'])} (already done)")
    print(f"{'list':<8}{'total':>7}{'valid':>7}{'invalid':>9}")
    for n in names:
        r = summary["lists"][n]
        print(f"{n:<8}{r['total']:>7}{r['valid']:>7}{r['invalid']:>9}")
        for why, k in r["invalid_by_reason"].items():
            print(f"{'':<10}{k:>3}  {why}")
    return 0


def cmd_recompute_fresh(a) -> int:
    """Re-derive fresh F2P/P2P from kept raw pytest logs with the current parser (no test runs)."""
    from . import mine
    d = repo_dir(a.workdir, a.repo)
    all_tasks = tasks_mod.read_tasks(d / "tasks.jsonl")
    fresh_ids = set(split_mod.Split.load(d / "split.json").fresh_ids)
    fresh = [t for t in all_tasks if t.id in fresh_ids]
    # Validation logs come from the same test runs (base+tests, base+tests+fix), repeated.
    changes, problems = mine.recompute_lists(fresh, [d / "validation" / "logs", d / "mine_logs"])
    tasks_mod.save_tasks(all_tasks, d / "tasks.jsonl")
    print(f"{len(fresh)} fresh tasks: {len(changes)} changed, {len(problems)} not recomputable (left as is)")
    for tid, c in changes.items():
        print(f"  changed {tid}: " + "; ".join(f"{k} {v}" for k, v in c.items() if v))
    for tid, p in problems.items():
        print(f"  problem {tid}: {p}")
    if changes:
        print("re-validate the changed tasks: their stored validation results used the old lists")
    return 1 if problems else 0


def cmd_mine_fresh(a) -> int:
    from . import gitutil, mine
    if a.recompute_from_logs:
        return cmd_recompute_fresh(a)
    if not a.since:
        raise SystemExit("--since is required (unless --recompute-from-logs)")
    d = repo_dir(a.workdir, a.repo)
    if not a.no_pull:
        gitutil.git(a.clone, "pull", "--ff-only", "--quiet")
    lib_prefix = a.lib_prefix or a.repo.split("/")[1] + "/"
    fresh, stats = mine.mine(a.repo, a.clone, a.since, a.limit, a.workdir / "workspaces", workers=a.workers,
                             lib_prefix=lib_prefix, test_prefix=a.test_prefix, max_lib_files=a.max_lib_files,
                             install=a.install, python_version=a.python, log_root=d / "mine_logs")
    # Re-mining replaces earlier mined tasks rather than appending duplicates.
    kept = [t for t in tasks_mod.read_tasks(d / "tasks.jsonl") if t.source != "mined"]
    tasks_mod.save_tasks(kept + fresh, d / "tasks.jsonl")
    s = split_mod.Split.load(d / "split.json")
    s = split_mod.attach_fresh(s, fresh, a.clone, a.workdir / "worktrees", margin_days=a.margin_days)
    s.save(d / "split.json")
    (d / "mine_fresh.json").write_text(json.dumps({"since": a.since, "limit": a.limit, **stats.to_dict()}, indent=2))

    print(f"scanned {stats.scanned} commits: accepted {stats.accepted}, skipped {sum(stats.skipped.values())}")
    for why, k in stats.skipped.most_common():
        print(f"  {k:>4}  {why}")
    if not fresh:
        return 1
    dates = sorted(t.created_at for t in fresh)
    print(f"fresh tasks: {dates[0][:10]} .. {dates[-1][:10]}")
    print(f"fresh snapshot: {s.fresh_snapshot_commit[:12]} ({s.fresh_snapshot_date})")
    leaks = {k: v for k, v in s.fresh_leakage.items() if v}
    if leaks:
        print(f"LEAKAGE in {len(leaks)} fresh task(s):")
        for k, v in leaks.items():
            print(f"  {k}: {'; '.join(v)}")
        return 1
    print("fresh leakage check: PASS (no fresh fix or test is present in the fresh snapshot)")
    return 0


BUILTIN_ARMS = Path(__file__).resolve().parents[2] / "arms"


def arm_dir(workdir: Path, repo: str, arm: str) -> Path | None:
    """An arm's files: generated arms in .uplift/<repo>/arms/<arm>, hand-written ones in arms/<arm>.
    "none" needs no files."""
    for d in (repo_dir(workdir, repo) / "arms" / arm, BUILTIN_ARMS / arm):
        if d.is_dir():
            return d
    if arm == "none":
        return None
    raise SystemExit(f"unknown arm {arm!r}: no {repo_dir(workdir, repo) / 'arms' / arm} or {BUILTIN_ARMS / arm}")


def cmd_generate(a) -> int:
    """One Muse Spark call (through the proxy) -> AGENTS.md + hook settings -> arm directories."""
    from datetime import datetime, timezone
    from . import generate as gen, gitutil
    d = repo_dir(a.workdir, a.repo)
    s = split_mod.Split.load(d / "split.json")
    risk = json.loads((d / "risk.json").read_text())
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = d / "generator" / run_id
    out.mkdir(parents=True)
    inputs = gen.collect_inputs(a.repo, a.clone, s.snapshot_commit, risk)
    messages = gen.build_messages(inputs)
    (out / "inputs.json").write_text(json.dumps(inputs, indent=2))
    (out / "messages.json").write_text(json.dumps(messages, indent=2))
    meta = {"run_id": run_id, "called_at": datetime.now(timezone.utc).isoformat(), "model": gen.MODEL,
            "snapshot": s.snapshot_commit, "cutoff": inputs["snapshot"]["date"],
            "fresh_snapshot": s.fresh_snapshot_commit, "inputs_sha256": gen.hashlib.sha256(
                (out / "inputs.json").read_bytes()).hexdigest(), "filter_stats": inputs["filter_stats"]}
    resp = gen.call_model(messages, max_tokens=a.max_tokens)
    (out / "response.json").write_text(json.dumps(resp, indent=2))
    text = resp["choices"][0]["message"]["content"]
    spec, problems = gen.parse_spec(text, inputs)
    (out / "spec.json").write_text(json.dumps(spec, indent=2))
    meta.update({"usage": resp.get("usage"), "problems": problems})
    if problems:
        (out / "meta.json").write_text(json.dumps(meta, indent=2))
        print(f"generator output rejected: {problems} (see {out})")
        return 1
    named = gen.paths_named(spec, risk)
    pre = ("", a.repo.split("/")[1] + "/")
    meta["missing_at_snapshot"] = {k: gen.check_paths(a.clone, s.snapshot_commit, v, pre) for k, v in named.items()}
    meta["missing_at_fresh_snapshot"] = {k: gen.check_paths(a.clone, s.fresh_snapshot_commit, v, pre)
                                         for k, v in named.items()} if s.fresh_snapshot_commit else {}
    arms = gen.render_arms(spec, risk, d / "arms", feedback=a.feedback, generator_run=run_id)
    meta["arms"] = arms
    (out / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"generator run {run_id}: usage {resp.get('usage')}")
    print(f"AGENTS.md: {len(spec['agents_md'].splitlines())} lines; co-change rules kept: {len(spec['cochange'])}")
    print(f"arms written to {d / 'arms'}: {', '.join(arms)}")
    for k, v in meta["missing_at_snapshot"].items():
        if v:
            print(f"WARNING: {k} paths missing at the test snapshot: {v}")
    for k, v in meta["missing_at_fresh_snapshot"].items():
        if v:
            print(f"fresh snapshot {s.fresh_snapshot_commit[:12]}: {len(v)} {k} path(s) no longer exist: {v}")
    return 0


def cmd_probe_hooks(a) -> int:
    from . import probe
    run_dir = a.workdir / "probes" / ("hooks-wrapped" if a.wrapped else "hooks")
    res = probe.run(a.workdir / "workspaces", run_dir, a.guard, wrapped=a.wrapped, agent_cmd=a.agent_cmd)
    print(json.dumps(res, indent=2))
    return 0


def cmd_run_one(a) -> int:
    from . import runner
    t = _task(a)
    arm = a.arm or (Path(a.setup).name if a.setup else "none")
    setup = Path(a.setup) if a.setup else arm_dir(a.workdir, a.repo, arm)
    from .batch import run_path
    run_dir = run_path(repo_dir(a.workdir, a.repo) / "runs", {"task": t.id, "arm": arm, "seed": a.seed})
    res = runner.attempt(t, a.clone, a.workdir / "workspaces", run_dir, arm=arm, setup_dir=setup,
                         seed=a.seed, guard=a.guard, max_steps=a.max_steps, timeout=a.timeout,
                         trust_usage=not a.strict_cost, python_version=a.python, agent_cmd=a.agent_cmd)
    g = res.grade or {}
    print(json.dumps({"task": t.id, "arm": arm, "resolved": res.resolved,
                      "f2p_failed": len(g.get("f2p_failed", [])), "regressions": len(g.get("p2p_failed", [])),
                      "cost_usd": res.cost_usd, "seconds": res.seconds, "agent_exit": res.agent_exit,
                      "error": res.error, "run_dir": str(run_dir)}))
    return 0


def cmd_regrade(a) -> int:
    """Free: re-grade finished runs from their saved agent.patch (fresh workspace, real tests)."""
    from . import batch, gitutil, runner
    d = repo_dir(a.workdir, a.repo)
    by_id = {t.id: t for t in tasks_mod.read_tasks(d / "tasks.jsonl")}
    workdir, clone = a.workdir.resolve(), a.clone.resolve()
    for spec in a.runs:
        arm, task, seed = spec.split("/")
        run_dir = batch.run_path(d / "runs", {"arm": arm, "task": task, "seed": seed})
        gitutil.ensure_commit(clone, by_id[task].base_commit)
        r = runner.regrade(by_id[task], clone, workdir / "workspaces", run_dir, python_version=a.python)
        g = r["grade"]
        print(json.dumps({"run": spec, "resolved": r["resolved"], "agent_exit": r["agent_exit"],
                          "f2p_failed": g["f2p_failed"], "p2p_failed": g["p2p_failed"], "error": g["error"],
                          "agent_end": r["agent_end"]}))
    return 0


def cmd_tune(a) -> int:
    """Paid: only through scripts/paid.sh. One Muse Spark call on dev results -> the tuned arm."""
    from datetime import datetime, timezone
    from . import generate as gen, screen, tune
    d = repo_dir(a.workdir, a.repo)
    s = split_mod.Split.load(d / "split.json")
    manifest = json.loads((d / "arms" / "both" / "MANIFEST.json").read_text())
    spec = json.loads((d / "generator" / manifest["generator_run"] / "spec.json").read_text())
    risk = json.loads((d / "risk.json").read_text())
    table = json.loads((d / "screen" / "dev_table.json").read_text())
    inputs = tune.collect_inputs(d, json.loads(a.plan.read_text()), spec, screen.load(d / "screen" / "screened.json"),
                                 table, a.findings.read_text(), s.dev_ids, s.test_ids + s.fresh_ids)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = d / "tune" / run_id
    out.mkdir(parents=True)
    messages = tune.build_messages(inputs)
    (out / "inputs.json").write_text(json.dumps(inputs, indent=2))
    (out / "messages.json").write_text(json.dumps(messages, indent=2))
    resp = gen.call_model(messages, max_tokens=a.max_tokens)
    (out / "response.json").write_text(json.dumps(resp, indent=2))
    tuned, checks, problems = tune.parse(resp["choices"][0]["message"].get("content"), spec)
    (out / "spec.json").write_text(json.dumps(dict(tuned, checks=checks), indent=2))
    meta = {"run_id": run_id, "model": gen.MODEL, "generator_run": manifest["generator_run"], "usage": resp.get("usage"),
            "tasks_where_arms_differed": len(inputs["tasks_where_arms_differed"]), "problems": problems}
    if not problems:
        pre = ("", a.repo.split("/")[1] + "/")
        named = gen.paths_named(tuned)["generated"]
        meta["missing_at_snapshot"] = gen.check_paths(a.clone, s.snapshot_commit, named, pre)
        meta["missing_at_fresh_snapshot"] = gen.check_paths(a.clone, s.fresh_snapshot_commit, named, pre)
        meta["files"] = tune.render(tuned, checks, risk, d / "arms", feedback=manifest_feedback(d), run_id=run_id)
    (out / "meta.json").write_text(json.dumps(meta, indent=2))
    if problems:
        print(f"tuner output rejected: {problems} (see {out})")
        return 1
    print(f"tune run {run_id}: usage {resp.get('usage')}")
    print(f"tuned arm: {len(tuned['agents_md'].splitlines())} lines of AGENTS.md; hooks kept: {checks or 'none'}; "
          f"{len(tuned['cochange'])} co-change rules; wording: {json.dumps(tuned['wording'])}")
    print(f"why: {tuned['why']}")
    for k in ("missing_at_snapshot", "missing_at_fresh_snapshot"):
        if meta[k]:
            print(f"{k}: {meta[k]}")
    print(tuned["agents_md"])
    return 0


def manifest_feedback(d: Path) -> str:
    """The same hook feedback mode as the generated arms."""
    return json.loads((d / "arms" / "both" / ".muse" / "uplift_hooks" / "config.json").read_text())["feedback"]


SCREEN_LISTS = ("dev", "test", "fresh")


def _screen_items(a) -> tuple[Path, list[dict]]:
    from . import batch, screen
    d = repo_dir(a.workdir, a.repo)
    s = split_mod.Split.load(d / "split.json")
    by_id = {t.id: t for t in tasks_mod.read_tasks(d / "tasks.jsonl")}
    return d / "screen", screen.collect(by_id, {n: getattr(s, batch.LISTS[n]) for n in SCREEN_LISTS}, a.clone.resolve())


def cmd_screen_plan(a) -> int:
    """Free: what `paid.sh screen` will ask, and its estimated cost. No model calls."""
    from . import screen
    out, items = _screen_items(a)
    todo = [it for it in items if not screen.item_path(out, it).exists()]
    src: dict[str, int] = {}
    for it in items:
        src[it["source"]] = src.get(it["source"], 0) + 1
    calls = sum(bool(it["messages"]) for it in todo)
    print(f"{len(items)} F2P tests in {len({it['task'] for it in items})} tasks; lines from: {json.dumps(src)}; "
          f"{sum(it['cut'] for it in items)} cut at {screen.MAX_LINES_CHARS} chars")
    print(f"to ask: {calls} calls, estimated ${screen.estimate_usd(todo):.3f}")
    return 0


def cmd_screen(a) -> int:
    """Paid: only through scripts/paid.sh. Prompts hold only the issue and the added test lines."""
    from . import screen
    out, items = _screen_items(a)
    results = screen.run(items, out, workers=a.workers)
    failed = [r for r in results if "failed" in r]
    if failed:
        print(f"{len(failed)} test(s) got no verdict, so screened.json was not written; run it again:")
        for r in failed[:5]:
            print(f"  {r['task']} {r['test']}: {r['failed']}")
        return 1
    print(f"-> {screen.save(results, out)}")
    return cmd_screen_report(a)


def _screened_outcomes(d: Path, runs: list[dict], screened: dict, grade_key) -> dict:
    """{(task, seed): {arm: resolved}} for tasks the screen keeps; a run with an error counts False."""
    from . import batch
    rows: dict = {}
    for r in runs:
        t = screened["tasks"].get(r["task"])
        res = batch.read_result(batch.run_path(d / "runs", r))
        if t and not t["dropped"] and res is not None:
            rows.setdefault((r["task"], r["seed"]), {})[r["arm"]] = grade_key(res, t)
    return rows


def cmd_screen_report(a) -> int:
    from . import screen
    d = repo_dir(a.workdir, a.repo)
    screened = screen.load(d / "screen" / "screened.json")
    print(f"{'list':<7}{'tasks':>6}{'kept':>6}{'dropped':>9}{'F2P tests':>11}{'excluded':>10}")
    for name, s in screen.summary(screened).items():
        print(f"{name:<7}{s['tasks']:>6}{s['kept']:>6}{s['dropped']:>9}{s['tests']:>11}{s['excluded']:>10}")
        if s["dropped_ids"]:
            print(f"       dropped: {' '.join(i.replace('tobymao__sqlglot-', '') for i in s['dropped_ids'])}")
    counts: dict[str, int] = {}
    for j in screened["judgements"]:
        counts[j["verdict"]] = counts.get(j["verdict"], 0) + 1
    print("verdicts:", json.dumps(counts))
    by_id = {t.id: t for t in tasks_mod.read_tasks(d / "tasks.jsonl")}
    for j in screen.sample(screened, a.sample, a.seed):
        rec = json.loads(screen.item_path(d / "screen", j).read_text())
        title = by_id[j["task"]].problem_statement.strip().splitlines()[0][:100]
        print(f"\n[{j['verdict'].upper()}] {j['task']} {j['test'].split('::')[-1]}\n  issue: {title}")
        for line in rec["lines"][:6]:
            print(f"  + {line.strip()[:120]}")
        if len(rec["lines"]) > 6:
            print(f"  + ... {len(rec['lines']) - 6} more")
        print(f"  why: {j['reason']}")
    return 0


def cmd_screen_table(a) -> int:
    """Free: per-arm results on the screened lists, from the per-test results in result.json."""
    from . import batch, screen
    d = repo_dir(a.workdir, a.repo)
    plan = json.loads(a.plan.read_text())
    screened = screen.load(d / "screen" / "screened.json")
    rows = _screened_outcomes(d, plan["runs"], screened, lambda res, t: screen.resolved(res.get("grade"), t["exclude"]))
    raw = _screened_outcomes(d, plan["runs"], screened, lambda res, t: bool(res.get("grade", {}).get("resolved")))
    arms = list(dict.fromkeys(r["arm"] for r in plan["runs"]))
    both, base = screen.paired(rows, arms), screen.paired(raw, arms)
    print(f"{len(rows)} task-seed rows on the screened lists ({len({k[0] for k in rows})} tasks)")
    print(f"{'arm':<15}{'solved':>7}{'of':>4}{'wins':>6}{'losses':>8}   unscreened: solved, wins, losses (same tasks)")
    for arm in arms:
        r, b = both[arm], base[arm]
        print(f"{arm:<15}{r['resolved']:>7}{r['tasks']:>4}{r['wins']:>6}{r['losses']:>8}   "
              f"{b['resolved']}, +{b['wins']}, -{b['losses']}")
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(json.dumps({"screened": both, "unscreened_same_tasks": base,
                                     "rows": {f"{k[0]}|{k[1]}": v for k, v in rows.items()}}, indent=2))
    return 0


def cmd_plan_batch(a) -> int:
    from . import batch
    d = repo_dir(a.workdir, a.repo)
    s = split_mod.Split.load(d / "split.json")
    ids = [i for n in a.ids.split(",") for i in getattr(s, batch.LISTS[n])]
    if a.tasks:
        wanted = a.tasks.split(",")
        if set(wanted) - set(ids):
            raise SystemExit(f"not in --ids {a.ids}: {sorted(set(wanted) - set(ids))}")
        ids = wanted

    def valid(tid: str) -> bool:
        p = d / "validation" / f"{tid}.json"
        return p.exists() and bool(json.loads(p.read_text()).get("valid"))

    dropped = [i for i in ids if not valid(i)]
    screen_ref = None
    if a.screen:
        from . import screen
        path = d / "screen" / "screened.json"
        screened = screen.load(path)["tasks"]
        unknown = [i for i in ids if i not in screened]
        if unknown:
            raise SystemExit(f"not screened: {unknown[:5]}")
        off = [i for i in ids if screened[i]["dropped"]]
        print(f"screen: {len(off)} task(s) with no F2P test left: {off}")
        dropped += [i for i in off if i not in dropped]
        screen_ref = {"path": str(path.resolve()), "sha256": screen.sha256(path)}
    arms = a.arms.split(",")
    for arm in arms:
        arm_dir(a.workdir, a.repo, arm)
    plan = batch.build_plan(a.repo, a.clone.resolve(), [i for i in ids if i not in dropped], arms,
                            [int(x) for x in a.seeds.split(",")], s.dev_ids)
    if screen_ref:
        plan["screen"] = screen_ref
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(plan, indent=2))
    todo = sum(batch.read_result(batch.run_path(d / "runs", r)) is None for r in plan["runs"])
    print(f"{plan['run_count']} runs ({todo} still to run), estimated ${todo * batch.EST_USD_PER_RUN:.2f} -> {a.out}")
    if dropped:
        print(f"left out {len(dropped)} task(s) not valid or dropped by the screen: {dropped}")
    return 0


def cmd_run_batch(a) -> int:
    """Paid: only through scripts/paid.sh."""
    import os
    import urllib.request
    from . import batch, gitutil, runner
    plan = json.loads(a.plan.read_text())
    workdir = a.workdir.resolve()
    d = repo_dir(workdir, plan["repo"])
    batch.check_plan(plan["runs"], split_mod.Split.load(d / "split.json").dev_ids)
    clone = Path(plan["clone"])
    by_id = {t.id: t for t in tasks_mod.read_tasks(d / "tasks.jsonl")}
    arms = {arm: arm_dir(workdir, plan["repo"], arm) for arm in {r["arm"] for r in plan["runs"]}}
    # One at a time, as in validate-batch: parallel fetches into the clone fail on its locks.
    for tid in sorted({r["task"] for r in plan["runs"]}):
        gitutil.ensure_commit(clone, by_id[tid].base_commit)
    proxy = os.environ.get("UPLIFT_PROXY", "http://127.0.0.1:8787")
    excluded: dict[str, list[str]] = {}
    if plan.get("screen"):
        from . import screen
        if screen.sha256(plan["screen"]["path"]) != plan["screen"]["sha256"]:
            raise SystemExit("screened.json changed since this plan was written; write the plan again")
        excluded = {tid: t["exclude"] for tid, t in screen.load(plan["screen"]["path"])["tasks"].items()}

    def budget() -> dict:
        with urllib.request.urlopen(f"{proxy}/__budget", timeout=5) as r:
            return json.loads(r.read())

    def one(r: dict):
        return runner.attempt(by_id[r["task"]], clone, workdir / "workspaces", batch.run_path(d / "runs", r),
                              arm=r["arm"], setup_dir=arms[r["arm"]], seed=r["seed"], guard=DEFAULT_GUARD,
                              excluded_f2p=excluded.get(r["task"], ()))

    out = batch.run_plan(plan["runs"], runs_root=d / "runs", ws_root=workdir / "workspaces",
                         summary_path=a.plan.with_suffix(".summary.json"), run_one=one, budget=budget,
                         max_usd=a.max_usd, workers=a.workers)
    print(json.dumps(out, indent=2))
    return 0 if out["status"] == "finished" else 1


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

    vb = sub.add_parser("validate-batch", help="validate every task in some split lists, in parallel")
    vb.add_argument("--repo", required=True)
    vb.add_argument("--clone", type=Path, required=True)
    vb.add_argument("--ids", default="dev,test", help="comma-separated split lists: dev,test,fresh,unused")
    vb.add_argument("--workers", type=int, default=4)
    vb.add_argument("--repeats", type=int, default=3)
    vb.add_argument("--python", default="3.12")
    vb.add_argument("--force", action="store_true", help="re-validate tasks that already have a result")
    vb.add_argument("--keep-workspaces", action="store_true", help="don't delete workspaces afterwards")
    vb.set_defaults(func=cmd_validate_batch)

    mf = sub.add_parser("mine-fresh", help="mine recent fix commits with a linked issue into fresh tasks")
    mf.add_argument("--repo", required=True)
    mf.add_argument("--clone", type=Path, required=True)
    mf.add_argument("--since", help="only commits on or after this date (YYYY-MM-DD)")
    mf.add_argument("--limit", type=int, default=40, help="stop after this many accepted tasks")
    mf.add_argument("--workers", type=int, default=4)
    mf.add_argument("--lib-prefix", help="library directory (default: <repo name>/)")
    mf.add_argument("--test-prefix", default="tests/")
    mf.add_argument("--max-lib-files", type=int, default=5)
    mf.add_argument("--install", default="pip install -e .[dev]")
    mf.add_argument("--python", default="3.12")
    mf.add_argument("--margin-days", type=int, default=1)
    mf.add_argument("--no-pull", action="store_true", help="don't `git pull` the clone first")
    mf.add_argument("--recompute-from-logs", action="store_true",
                    help="don't mine: recompute fresh F2P/P2P from kept validation/mine logs and rewrite them")
    mf.set_defaults(func=cmd_mine_fresh)

    g = sub.add_parser("generate", help="Muse Spark writes the repo-specific setup (paid: via scripts/paid.sh)")
    g.add_argument("--repo", required=True)
    g.add_argument("--clone", type=Path, required=True)
    g.add_argument("--max-tokens", type=int, default=16000,
                   help="Muse Spark spends most of its budget on hidden reasoning (3.5K of 4K on the first run)")
    g.add_argument("--feedback", choices=["block_reason", "additional_context"], default="additional_context",
                   help="how PostToolUse sensor hooks report findings (both work, per the hook probe); "
                        "the Stop hook always uses decision: block")
    g.set_defaults(func=cmd_generate)

    p = sub.add_parser("probe-hooks", help="can Muse hooks block / feed back? (paid: via scripts/paid.sh)")
    p.add_argument("--wrapped", action="store_true", help='nest the event map under a "hooks" key')
    p.add_argument("--guard", type=Path, default=DEFAULT_GUARD)
    p.add_argument("--agent-cmd", help=argparse.SUPPRESS)  # tests only
    p.set_defaults(func=cmd_probe_hooks)

    o = sub.add_parser("run-one", help="one agent attempt on one task, graded by the real tests")
    o.add_argument("--repo", required=True)
    o.add_argument("--clone", type=Path, required=True)
    o.add_argument("--task", required=True)
    o.add_argument("--arm", help="arm to install: none, prose, sensors, both, handwritten, lint-only, ... "
                                 "(default: none)")
    o.add_argument("--setup", help="explicit folder to install instead of a named arm (tests/debugging)")
    o.add_argument("--seed", type=int, default=1)
    o.add_argument("--max-steps", type=int, default=40)
    o.add_argument("--timeout", type=int, default=2400,
                   help="seconds before the agent is killed; a timed-out run is an error, never graded")
    o.add_argument("--python", default="3.12")
    o.add_argument("--guard", type=Path, default=DEFAULT_GUARD)
    o.add_argument("--strict-cost", action="store_true", help="charge worst case instead of parsed cost")
    o.add_argument("--agent-cmd", help=argparse.SUPPRESS)  # tests only: replaces the agent
    o.set_defaults(func=cmd_run_one)

    tn = sub.add_parser("tune", help="Muse Spark writes the tuned arm from dev results (paid: via scripts/paid.sh)")
    tn.add_argument("--repo", required=True)
    tn.add_argument("--clone", type=Path, required=True)
    tn.add_argument("--plan", type=Path, required=True, help="the dev plan")
    tn.add_argument("--findings", type=Path, required=True, help="text file: written findings from dev")
    tn.add_argument("--max-tokens", type=int, default=16000)
    tn.set_defaults(func=cmd_tune)

    sp = sub.add_parser("screen-plan", help="what `paid.sh screen` will ask and its estimated cost (free)")
    sp.add_argument("--repo", required=True)
    sp.add_argument("--clone", type=Path, required=True)
    sp.set_defaults(func=cmd_screen_plan)
    for flag, value in (("--workers", 8), ("--sample", 5), ("--seed", 1)):  # paid.sh passes `screen`'s flags here
        sp.add_argument(flag, type=int, default=value, help=argparse.SUPPRESS)

    sc = sub.add_parser("screen", help="Muse Spark screens every F2P test (paid: via scripts/paid.sh)")
    sc.add_argument("--repo", required=True)
    sc.add_argument("--clone", type=Path, required=True)
    sc.add_argument("--workers", type=int, default=8)
    sc.add_argument("--sample", type=int, default=5, help="random judgements to print per verdict")
    sc.add_argument("--seed", type=int, default=1)
    sc.set_defaults(func=cmd_screen)

    sr = sub.add_parser("screen-report", help="kept / excluded / dropped per list, and a random sample (free)")
    sr.add_argument("--repo", required=True)
    sr.add_argument("--sample", type=int, default=5)
    sr.add_argument("--seed", type=int, default=1)
    sr.set_defaults(func=cmd_screen_report)

    st = sub.add_parser("screen-table", help="per-arm results of a plan on the screened lists (free)")
    st.add_argument("--repo", required=True)
    st.add_argument("--plan", type=Path, required=True)
    st.add_argument("--out", type=Path)
    st.set_defaults(func=cmd_screen_table)

    rg = sub.add_parser("regrade", help="re-grade finished runs from their saved agent.patch (free)")
    rg.add_argument("--repo", required=True)
    rg.add_argument("--clone", type=Path, required=True)
    rg.add_argument("--python", default="3.12")
    rg.add_argument("runs", nargs="+", help="<arm>/<task id>/<seed>")
    rg.set_defaults(func=cmd_regrade)

    pb = sub.add_parser("plan-batch", help="write the list of (task, arm, seed) runs for run-batch")
    pb.add_argument("--repo", required=True)
    pb.add_argument("--clone", type=Path, required=True)
    pb.add_argument("--ids", default="dev", help="comma-separated split lists: dev,test,fresh,unused")
    pb.add_argument("--tasks", help="comma-separated task ids (default: every valid task in --ids)")
    pb.add_argument("--arms", default="none,prose,sensors,both,handwritten,lint-only,cochange-only,verify-only")
    pb.add_argument("--seeds", default="1")
    pb.add_argument("--out", type=Path, required=True)
    pb.add_argument("--screen", action="store_true", help="use the screened F2P lists (screen/screened.json)")
    pb.set_defaults(func=cmd_plan_batch)

    rb = sub.add_parser("run-batch", allow_abbrev=False, help="run a plan in parallel (paid: via scripts/paid.sh)")
    rb.add_argument("--plan", type=Path, required=True)
    rb.add_argument("--workers", type=int, default=4)
    rb.add_argument("--max-usd", type=float, required=True, help="start no new run once this batch has spent this")
    rb.set_defaults(func=cmd_run_batch)

    a = ap.parse_args(argv)
    return a.func(a)


if __name__ == "__main__":
    sys.exit(main())
