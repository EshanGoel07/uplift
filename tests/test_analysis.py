"""Batch analysis and the results.json export, on small made-up batches."""

import gzip
import json
from pathlib import Path

import pytest

from uplift import analysis, screen
from uplift.analysis import Batch


def batch(tmp_path, grid, cost=0.03):
    """grid: {task: {arm: [resolved per seed]}}."""
    results, dirs = {}, {}
    for task, arms in grid.items():
        for arm, seeds in arms.items():
            for i, ok in enumerate(seeds, 1):
                results[(task, arm, i)] = {"resolved": ok, "cost_usd": cost, "grade": {"p2p_failed": []}}
                dirs[(task, arm, i)] = tmp_path / arm / f"{task}-s{i}"
                dirs[(task, arm, i)].mkdir(parents=True)
    first = next(iter(grid.values()))
    return Batch(list(grid), list(first), [1, 2], {t: "test" for t in grid}, results, dirs)


def test_bootstrap_is_paired_deterministic_and_on_the_task_level():
    m = {"none": [1, 0, 1, 0, 1, 0], "a": [1, 0, 1, 0, 1, 0], "b": [1, 1, 1, 0, 1, 0]}
    one, two = analysis.bootstrap(m, n=500, seed=3), analysis.bootstrap(m, n=500, seed=3)
    assert one == two
    assert one["none"]["diff_ci"] == (0.0, 0.0)
    assert one["a"]["diff_ci"] == (0.0, 0.0)     # identical arm: pairing removes all noise
    assert one["b"]["diff"] == pytest.approx(1 / 6)
    assert one["b"]["diff_ci"][0] >= 0           # never worse on any task


def test_arm_rows_counts_regressions_and_cost(tmp_path):
    b = batch(tmp_path, {"t1": {"none": [True, True], "x": [True, False]}, "t2": {"none": [False, False], "x": [False, False]}})
    b.results[("t2", "x", 1)]["grade"]["p2p_failed"] = ["tests/a.py::b"]
    rows = {r["id"]: r for r in analysis.arm_rows(b)}
    assert (rows["none"]["solved"], rows["none"]["attempts"], rows["none"]["rate"]) == (2, 4, 0.5)
    assert rows["x"]["solved"] == 1 and rows["x"]["regressions"] == 1
    assert rows["x"]["diff_vs_none"] == -0.25
    assert rows["x"]["cost_per_solved"] == pytest.approx(0.12)


def ledger(path, rows):
    path.write_text("time,model,input_tokens,cached_tokens,output_tokens,cost_usd,usage_missing_estimated,total_spent_usd\n"
                    + "".join(f"t,{m},0,0,0,{c},False,0\n" for m, c in rows))
    return path


def test_ledger_uses_the_batch_run_when_a_smoke_run_shares_its_path(tmp_path):
    b = batch(tmp_path, {"t1": {"none": [True, True]}})
    a, c = (str(b.dirs[("t1", "none", i)].resolve()) for i in (1, 2))
    log = ledger(tmp_path / "l.csv", [(f"external:muse {a}", 0.5), (f"external:muse {a}", 0.1),
                                      (f"external:muse {c}", 0.2), ("muse-spark-1.3-contributor", 9)])
    assert analysis.ledger_cost(b, log) == pytest.approx(0.3)


def test_ledger_refuses_a_run_with_no_row(tmp_path):
    b = batch(tmp_path, {"t1": {"none": [True, True]}})
    with pytest.raises(SystemExit):
        analysis.ledger_cost(b, ledger(tmp_path / "l.csv", []))


def trace(run_dir: Path, inputs: list[list[dict]]):
    with gzip.open(run_dir / "stderr_trace.log.gz", "wt") as f:
        f.write("muse: workspace root\n")
        for items in inputs:
            f.write("REQUEST: " + json.dumps({"input": items}) + "\n")


def hooks(run_dir: Path, recs: list[dict]):
    (run_dir / "hooks.jsonl").write_text("".join(json.dumps(r) + "\n" for r in recs))


def test_sent_messages_quiet_hooks_send_nothing(tmp_path):
    hooks(tmp_path, [{"check": "verify", "fired": False, "detail": "ran: tests/test_x.py"}])
    trace(tmp_path, [[{"role": "developer", "content": "hi"}]])
    assert analysis.sent_messages(tmp_path) == ([], [])


def test_sent_messages_come_from_the_model_requests_in_full(tmp_path):
    long = "verify: related tests fail (a).\n" + "x" * 3000 + "\nFAILED tests/a.py::t"
    hooks(tmp_path, [{"check": "lint", "fired": True, "detail": "ruff format: a.py is not formatted"},
                     {"check": "verify", "fired": True, "detail": long[:2000]}])
    lint = {"role": "developer", "content": "Uplift checks:\nruff format: a.py is not formatted"}
    stop = {"role": "developer", "content": f"Sandbox text.\n\nUplift checks:\n{long}\n\n<system-reminder source=\"m\">\nx\n</system-reminder>"}
    side_call = {"role": "user", "content": "<text>Uplift checks:\nquoted transcript, not a message</text>"}
    trace(tmp_path, [[lint], [lint, stop, side_call]])
    sent, lost = analysis.sent_messages(tmp_path)
    assert sent == [lint["content"], f"Uplift checks:\n{long}"]    # once each, not cut, no Muse text
    assert lost == []


def test_a_stop_block_after_the_last_step_is_not_sent(tmp_path):
    hooks(tmp_path, [{"check": "verify", "fired": True, "detail": "verify: related tests fail (a).\nFAILED"}])
    trace(tmp_path, [[{"role": "developer", "content": "no hook text here"}]])
    sent, lost = analysis.sent_messages(tmp_path)
    assert sent == [] and [r["check"] for r in lost] == ["verify"]


def test_multi_finding_message_matches_each_logged_record(tmp_path):
    # The log joins findings with \n; the agent gets them joined with \n\n.
    hooks(tmp_path, [{"check": "cochange", "fired": True, "detail": "co-change: first\nco-change: second"}])
    trace(tmp_path, [[{"role": "developer", "content": "Uplift checks:\nco-change: first\n\nco-change: second"}]])
    assert analysis.sent_messages(tmp_path)[1] == []


def test_cut_diff_says_it_was_cut():
    assert analysis.cut_diff("abc", limit=5) == "abc"
    out = analysis.cut_diff("x" * 10, limit=4)
    assert out.startswith("xxxx\n[... diff truncated") and "6 more" in out


def test_scrub_removes_machine_paths(tmp_path):
    ws = tmp_path / "workspaces"
    assert analysis.scrub(f"{ws}/task-1/both-s1/tests/a.py failed", ws) == "<workspace>/tests/a.py failed"
    assert str(Path.home()) not in analysis.scrub(f"{Path.home()}/x", ws)


def test_load_refuses_a_missing_run_and_a_resolved_the_grade_does_not_support(tmp_path):
    screened = tmp_path / "screened.json"
    screened.write_text(json.dumps({"tasks": {"t1": {"exclude": [], "keep": ["a"], "dropped": False, "list": "test"}}}))
    plan = {"screen": {"path": str(screened), "sha256": screen.sha256(screened)},
            "runs": [{"task": "t1", "arm": "none", "seed": 1}]}
    with pytest.raises(SystemExit, match="no result"):
        analysis.load(tmp_path, plan, {"test": ["t1"], "fresh": []})
    run = tmp_path / "runs" / "none" / "t1-s1"
    run.mkdir(parents=True)
    (run / "result.json").write_text(json.dumps({"resolved": True, "grade": {"f2p_passed": [], "f2p_failed": ["a"]}}))
    with pytest.raises(SystemExit, match="does not match"):
        analysis.load(tmp_path, plan, {"test": ["t1"], "fresh": []})


def test_load_refuses_a_changed_screen_file(tmp_path):
    screened = tmp_path / "screened.json"
    screened.write_text("{}")
    with pytest.raises(SystemExit, match="changed"):
        analysis.load(tmp_path, {"screen": {"path": str(screened), "sha256": "0"}, "runs": []}, {})


def test_trust_card_reports_the_web_gap(tmp_path):
    web = {"exposed": 80, "lo": 12, "hi": 16, "clean_tasks": 53, "clean_clear": False}
    cards = analysis.trust_cards(21.31, 924, web)
    assert len(cards) == 6
    text = json.dumps(cards)
    assert "80 of 924" in text and "12-16 per arm" in text
    assert "can't be looked up" not in text
