"""Validate many tasks in parallel: one `uplift validate` subprocess per task, so tasks are
isolated from each other. Results land in .uplift/<repo>/validation/<id>.json (the same
files `uplift validate` writes) plus a summary.json per split list.

The split is never changed based on these results; invalid tasks are just excluded later.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

LISTS = {"dev": "dev_ids", "test": "test_ids", "fresh": "fresh_ids", "unused": "unused_ids"}


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
