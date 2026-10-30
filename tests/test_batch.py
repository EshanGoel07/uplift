"""validate-batch: skip / force / cleanup / summary, plus one real subprocess run."""

import json

import pytest

from uplift import batch, cli, split, tasks

from .test_runner import calc  # noqa: F401 (fixture)


def fake_validator(out_dir, ws_root, valid=lambda tid: True, crash=()):
    calls = []

    def one(tid):
        calls.append(tid)
        (ws_root / tid / "validate").mkdir(parents=True, exist_ok=True)
        if tid in crash:
            return {"task_id": tid, "valid": False, "error": "exit 2: boom", "notes": []}
        ok = valid(tid)
        notes = [] if ok else ["after fix: f2p_failed=['t'] p2p_failed=[] "]
        (out_dir / f"{tid}.json").write_text(json.dumps({"task_id": tid, "valid": ok, "notes": notes}))
        return None
    return one, calls


def test_skip_force_and_cleanup(tmp_path):
    out, ws = tmp_path / "validation", tmp_path / "workspaces"
    one, calls = fake_validator(out, ws, valid=lambda tid: tid != "b")
    s = batch.run_batch({"dev": ["a", "b"], "test": ["c"]}, out_dir=out, ws_root=ws, workers=2, validate_one=one)
    assert sorted(calls) == ["a", "b", "c"]
    assert not ws.exists() or not any(ws.iterdir()), "workspaces are deleted after validating"
    assert s["lists"]["dev"] == {"total": 2, "valid": 1, "invalid": 1,
                                 "invalid_by_reason": {"FAIL_TO_PASS still failing after the real fix": 1},
                                 "invalid_ids": [{"id": "b", "reason": "after fix: f2p_failed=['t'] p2p_failed=[] "}]}
    assert s["lists"]["test"]["valid"] == 1

    calls.clear()
    s = batch.run_batch({"dev": ["a", "b"]}, out_dir=out, ws_root=ws, validate_one=one)
    assert calls == [] and sorted(s["last_run"]["skipped_existing"]) == ["a", "b"]
    assert "test" in s["lists"], "summary keeps lists not in this run"

    batch.run_batch({"dev": ["a"]}, out_dir=out, ws_root=ws, force=True, keep_workspaces=True, validate_one=one)
    assert calls == ["a"] and (ws / "a" / "validate").exists()


def test_cleanup_keeps_other_workspaces_of_the_task(tmp_path):
    out, ws = tmp_path / "validation", tmp_path / "workspaces"
    (ws / "a" / "baseline-s1").mkdir(parents=True)          # a run-one workspace must survive
    one, _ = fake_validator(out, ws)
    batch.run_batch({"dev": ["a"]}, out_dir=out, ws_root=ws, validate_one=one)
    assert (ws / "a" / "baseline-s1").exists() and not (ws / "a" / "validate").exists()


def test_crashes_are_recorded_and_retried(tmp_path):
    out, ws = tmp_path / "validation", tmp_path / "workspaces"
    one, calls = fake_validator(out, ws, crash={"a"})
    s = batch.run_batch({"dev": ["a"]}, out_dir=out, ws_root=ws, validate_one=one)
    assert s["lists"]["dev"]["invalid_by_reason"] == {"crashed (install/run error)": 1}
    batch.run_batch({"dev": ["a"]}, out_dir=out, ws_root=ws, validate_one=one)
    assert calls == ["a", "a"], "a crashed result is not treated as done"


def test_forced_rerun_that_crashes_does_not_keep_old_result(tmp_path):
    out, ws = tmp_path / "validation", tmp_path / "workspaces"
    out.mkdir()
    (out / "a.json").write_text(json.dumps({"task_id": "a", "valid": True, "notes": []}))
    s = batch.run_batch({"dev": ["a"]}, out_dir=out, ws_root=ws, force=True, validate_one=lambda tid: None)
    assert s["lists"]["dev"]["invalid_ids"] == [{"id": "a", "reason": "error: no result written"}]


def test_validate_batch_cli_end_to_end(calc, tmp_path):  # noqa: F811
    repo, task = calc
    wd = tmp_path / "wd"
    d = wd / "o__calc"
    tasks.save_tasks([task], d / "tasks.jsonl")
    split.Split(repo="o/calc", test_ids=[task.id], dev_ids=[], unused_ids=[], cutoff=task.created_at).save(d / "split.json")
    assert cli.main(["--workdir", str(wd), "validate-batch", "--repo", "o/calc", "--clone", str(repo),
                     "--ids", "dev,test", "--workers", "2", "--repeats", "1"]) == 0
    r = json.loads((d / "validation" / f"{task.id}.json").read_text())
    assert r["valid"] and r["fails_before"] == [True] and r["passes_after"] == [True]
    s = json.loads((d / "validation" / "summary.json").read_text())
    assert s["lists"]["test"]["valid"] == 1 and s["lists"]["dev"]["total"] == 0
    assert not (wd / "workspaces" / task.id).exists()
    logs = d / "validation" / "logs" / task.id   # raw pytest output outlives the workspace
    assert "1 failed" in (logs / "before-0.txt").read_text() and "2 passed" in (logs / "after-0.txt").read_text()


def paid_plan(tmp_path, runs, *, spent=lambda started: 0.0, max_usd=5.0):
    """run_plan with a fake agent run and a fake proxy. Returns (summary, runs started)."""
    root, ws, started = tmp_path / "runs", tmp_path / "workspaces", []

    def run_one(r):
        started.append(r)
        d = batch.run_path(root, r)
        d.mkdir(parents=True, exist_ok=True)
        (ws / r["task"] / f"{r['arm']}-s{r['seed']}").mkdir(parents=True, exist_ok=True)
        (d / "stdout.jsonl").write_text("{}\n")
        (d / "result.json").write_text(json.dumps({"task_id": r["task"], "resolved": True, "error": "", "grade": {}}))

    def budget():
        return {"spent_usd": spent(len(started)), "remaining_usd": 90.0, "blocked": False}

    out = batch.run_plan(runs, runs_root=root, ws_root=ws, summary_path=tmp_path / "plan.summary.json",
                         run_one=run_one, budget=budget, max_usd=max_usd, workers=1)
    return out, started


RUNS = [{"task": t, "arm": "none", "seed": 1} for t in ("a", "b", "c")]


@pytest.mark.parametrize("task", ["test-1", "fresh-1"])
def test_ablation_arms_refused_on_test_and_fresh(tmp_path, task):
    with pytest.raises(SystemExit):
        batch.build_plan("o/r", tmp_path, [task], ["none", "lint-only"], [1], dev_ids=["dev-1"])
    assert batch.build_plan("o/r", tmp_path, [task], ["none", "tuned"], [1], dev_ids=["dev-1"])["run_count"] == 2
    assert batch.build_plan("o/r", tmp_path, ["dev-1"], ["lint-only"], [1], dev_ids=["dev-1"])["run_count"] == 1
    with pytest.raises(SystemExit):  # a hand-edited plan is caught when it is run, too
        batch.check_plan([{"task": task, "arm": "verify-only", "seed": 1}], dev_ids=["dev-1"])


def test_stopped_batch_resumes_and_skips_finished_runs(tmp_path):
    done = batch.run_path(tmp_path / "runs", RUNS[0])
    done.mkdir(parents=True)
    (done / "result.json").write_text(json.dumps({"resolved": False, "error": "agent timed out", "grade": {}}))
    out, started = paid_plan(tmp_path, RUNS)
    assert started == RUNS[1:], "a run with a result, even an error, is not run again"
    assert out["status"] == "finished" and out["done"] == 3 and out["errors"] == 1
    assert out["per_arm"]["none"] == {"done": 3, "resolved": 2, "errors": 1}
    run_dir = batch.run_path(tmp_path / "runs", RUNS[1])
    assert (run_dir / "stdout.jsonl.gz").exists() and not (run_dir / "stdout.jsonl").exists()
    assert not any((tmp_path / "workspaces").iterdir()), "workspaces are deleted"
    assert json.loads((tmp_path / "plan.summary.json").read_text())["done"] == 3


def test_max_usd_stops_new_runs(tmp_path):
    out, started = paid_plan(tmp_path, RUNS, spent=lambda n: 10.0 + n, max_usd=2.0)
    assert len(started) == 2 and out["status"] == "stopped" and "--max-usd" in out["stop_reason"]
    assert out["spent_usd"] == 2.0
