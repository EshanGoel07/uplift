"""Validate many tasks in parallel: one `uplift validate` subprocess per task, so tasks are
isolated from each other. Results land in .uplift/<repo>/validation/<id>.json (the same
files `uplift validate` writes) plus a summary.json per split list.

The split is never changed based on these results; invalid tasks are just excluded later.

Also the paid batch: `build_plan` lists (task, arm, seed) runs, `run_plan` runs them in parallel,
one workspace each, skipping runs that already have a result.
"""

from __future__ import annotations

import gzip
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path

from .runner import RunResult

LISTS = {"dev": "dev_ids", "test": "test_ids", "fresh": "fresh_ids", "unused": "unused_ids"}
EST_USD_PER_RUN = 0.035
REPORT_ARMS = ("none", "prose", "sensors", "both", "handwritten", "tuned")
ABLATION_ARMS = ("lint-only", "cochange-only", "verify-only")  # dev only
MIN_REMAINING_USD = 5.0


def _done(path: Path) -> bool:
    """A finished result exists. Crashed runs (`error`) are retried."""
    if not path.exists():
        return False
    try:
        return "error" not in json.loads(path.read_text())
    except ValueError:
        return False


def validate_subprocess(task_id: str, *, repo: str, clone: Path, workdir: Path, repeats: int,
                        python: str, timeout: int = 3600) -> dict | None:
    """Run `uplift validate` for one task. Returns an error record if it crashed, else None
    (the subprocess wrote the result file itself)."""
    cmd = [sys.executable, "-m", "uplift.cli", "--workdir", str(workdir), "validate", "--repo", repo,
           "--clone", str(clone), "--task", task_id, "--repeats", str(repeats), "--python", python]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"task_id": task_id, "valid": False, "error": f"timeout after {timeout}s", "notes": []}
    result = workdir / repo.replace("/", "__") / "validation" / f"{task_id}.json"
    if proc.returncode in (0, 1) and result.exists():  # validate exits 1 for invalid tasks
        return None
    return {"task_id": task_id, "valid": False, "error": f"exit {proc.returncode}: {proc.stderr.strip()[-400:]}",
            "notes": []}


def reason(result: dict) -> str:
    if result.get("error"):
        return f"error: {result['error']}"
    notes = result.get("notes") or []
    return notes[0] if notes else "unknown"


def category(result: dict) -> str:
    r = reason(result)
    if r.startswith("error"):
        return "crashed (install/run error)"
    if r.startswith("before fix: test patch applied=False"):
        return "test patch did not apply"
    if r.startswith("before fix"):
        return "FAIL_TO_PASS already passing before the fix"
    if r.startswith("real fix did not apply"):
        return "real fix did not apply"
    if r.startswith("after fix") and "p2p_failed=[]" in r:
        return "FAIL_TO_PASS still failing after the real fix"
    if r.startswith("after fix"):
        return "PASS_TO_PASS failing after the real fix"
    return r[:60]


def run_batch(lists: dict[str, list[str]], *, out_dir: Path, ws_root: Path, workers: int = 4,
              force: bool = False, keep_workspaces: bool = False, validate_one=None) -> dict:
    """Validate every id in `lists` ({list name: ids}). `validate_one(task_id)` returns an
    error record or None (result file written by it). Returns the summary."""
    out_dir.mkdir(parents=True, exist_ok=True)
    todo, skipped = [], []
    for ids in lists.values():
        for tid in ids:
            if tid in todo or tid in skipped:
                continue
            (skipped if _done(out_dir / f"{tid}.json") and not force else todo).append(tid)

    def one(tid: str) -> None:
        (out_dir / f"{tid}.json").unlink(missing_ok=True)  # a crashed --force rerun must not keep the old result
        err = validate_one(tid)
        if err is not None or not (out_dir / f"{tid}.json").exists():
            err = err or {"task_id": tid, "valid": False, "error": "no result written", "notes": []}
            (out_dir / f"{tid}.json").write_text(json.dumps(err, indent=2))
        if not keep_workspaces:
            ws = ws_root / tid / "validate"
            shutil.rmtree(ws, ignore_errors=True)
            if ws.parent.exists() and not any(ws.parent.iterdir()):
                ws.parent.rmdir()

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        list(pool.map(one, todo))

    summary_path = out_dir / "summary.json"
    try:
        summary = json.loads(summary_path.read_text())
    except (OSError, ValueError):
        summary = {}
    summary.setdefault("lists", {})
    for name, ids in lists.items():
        results = [json.loads((out_dir / f"{tid}.json").read_text()) for tid in ids]
        invalid = [r for r in results if not r.get("valid")]
        cats: dict[str, int] = {}
        for r in invalid:
            cats[category(r)] = cats.get(category(r), 0) + 1
        summary["lists"][name] = {
            "total": len(ids), "valid": len(ids) - len(invalid), "invalid": len(invalid),
            "invalid_by_reason": dict(sorted(cats.items(), key=lambda kv: -kv[1])),
            "invalid_ids": [{"id": r["task_id"], "reason": reason(r)} for r in invalid],
        }
    summary["last_run"] = {"validated": todo, "skipped_existing": skipped}
    summary_path.write_text(json.dumps(summary, indent=2))
    return summary


def check_plan(runs: list[dict], dev_ids: list[str]) -> None:
    """Ablation arms run on dev tasks only; test/fresh tasks only ever get the report arms."""
    bad = sorted({f"{r['task']} / {r['arm']}" for r in runs if r["arm"] not in REPORT_ARMS
                  and not (r["arm"] in ABLATION_ARMS and r["task"] in dev_ids)})
    if bad:
        raise SystemExit(f"{len(bad)} run(s) use an arm not allowed for their task, e.g. {bad[:3]}")


def build_plan(repo: str, clone: Path, ids: list[str], arms: list[str], seeds: list[int], dev_ids: list[str]) -> dict:
    """Task by task, so a batch stopped early leaves whole tasks to compare across arms."""
    runs = [{"task": t, "arm": a, "seed": s} for t in ids for s in seeds for a in arms]
    check_plan(runs, dev_ids)
    return {"repo": repo, "clone": str(clone), "runs": runs, "run_count": len(runs),
            "est_usd": round(len(runs) * EST_USD_PER_RUN, 2)}


def run_path(runs_root: Path, r: dict) -> Path:
    return Path(runs_root) / r["arm"] / f"{r['task']}-s{r['seed']}"


def read_result(run_dir: Path) -> dict | None:
    try:
        return json.loads((run_dir / "result.json").read_text())
    except (OSError, ValueError):
        return None


def gzip_logs(run_dir: Path) -> None:
    for name in ("stderr_trace.log", "stdout.jsonl"):
        src = run_dir / name
        if src.exists():
            with src.open("rb") as f, gzip.open(run_dir / f"{name}.gz", "wb") as out:
                shutil.copyfileobj(f, out)
            src.unlink()


def run_plan(runs: list[dict], *, runs_root: Path, ws_root: Path, summary_path: Path, run_one, budget,
             max_usd: float, workers: int = 4) -> dict:
    """Run every run without a result (an errored run has one, so delete its folder to retry).
    `run_one(run)` must write result.json, or leave none if the agent never started, which stops
    the batch. `budget()` returns the proxy's /__budget. No new run starts once this batch has
    spent `max_usd`; runs already going finish, so the spend can pass it by up to `workers` runs."""
    todo = iter([r for r in runs if read_result(run_path(runs_root, r)) is None])
    lock = threading.Lock()
    start_spent = budget()["spent_usd"]
    state = {"stop": "", "spent": 0.0, "running": []}
    t0 = time.time()

    def write_summary(status: str) -> dict:
        arms: dict = {}
        errors = done = 0
        for r in runs:
            res = read_result(run_path(runs_root, r))
            if res is None:
                continue
            a = arms.setdefault(r["arm"], {"done": 0, "resolved": 0, "errors": 0})
            err = bool(res.get("error") or (res.get("grade") or {}).get("error"))
            done, errors = done + 1, errors + err
            a["done"] += 1
            a["resolved"] += bool(res.get("resolved"))
            a["errors"] += err
        out = {"status": status, "stop_reason": state["stop"], "total": len(runs), "done": done,
               "running": state["running"], "errors": errors, "spent_usd": round(state["spent"], 6),
               "max_usd": max_usd, "wall_seconds": round(time.time() - t0), "per_arm": arms}
        tmp = summary_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(out, indent=2))
        os.replace(tmp, summary_path)
        return out

    def check_budget() -> str:
        try:
            b = budget()
        except OSError as e:
            return f"proxy unreachable: {e}"
        state["spent"] = b["spent_usd"] - start_spent
        if b.get("blocked") or b["remaining_usd"] < MIN_REMAINING_USD:
            return f"budget: blocked={b.get('blocked')}, ${b['remaining_usd']} remaining"
        return f"--max-usd {max_usd} reached" if state["spent"] >= max_usd else ""

    def one(r: dict) -> None:
        run_dir = run_path(runs_root, r)
        try:
            res = run_one(r)
            if read_result(run_dir) is None:
                with lock:
                    state["stop"] = state["stop"] or f"{r['task']}/{r['arm']}: {res.error}"
        except Exception:  # crashed outside the agent (install, grading): an error, never a pass
            guard = run_dir / "guard_summary.json"
            cost = json.loads(guard.read_text()).get("parsed_cost_usd") if guard.exists() else None
            run_dir.mkdir(parents=True, exist_ok=True)
            res = RunResult(r["task"], r["arm"], r["seed"], False, {}, cost_usd=cost,
                            error="crash: " + traceback.format_exc()[-1500:])
            (run_dir / "result.json").write_text(json.dumps(asdict(res), indent=2))
        finally:
            shutil.rmtree(Path(ws_root) / r["task"] / f"{r['arm']}-s{r['seed']}", ignore_errors=True)
            gzip_logs(run_dir)

    def worker() -> None:
        while True:
            with lock:
                state["stop"] = state["stop"] or check_budget()
                r = None if state["stop"] else next(todo, None)
                if r is None:
                    return
                state["running"].append(r)
                write_summary("running")
            one(r)
            with lock:
                state["running"].remove(r)
                write_summary("running")

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = [pool.submit(worker) for _ in range(max(1, workers))]
        try:
            for f in futures:
                f.result()
        except KeyboardInterrupt:  # finish what is running: killing a guard leaves its reservation held
            state["stop"] = "interrupted"
            for f in futures:
                f.result()
    check_budget()  # final spend, including the last runs to finish
    for d in Path(ws_root).glob("*"):  # only now: workers share these per-task folders
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    return write_summary("stopped" if state["stop"] else "finished")
