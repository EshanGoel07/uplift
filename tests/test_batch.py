"""validate-batch: skip / force / cleanup / summary, plus one real subprocess run."""

import json

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
