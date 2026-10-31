"""The tuned arm: dev data only, valid output only, rendered like the other arms."""

import json

import pytest

from uplift import batch, generate as gen, tune

SPEC = {"agents_md": "# old", "lint": {"ruff_check_args": [], "format_line_length": 100, "why": ""},
        "cochange": [{"if_edited": "a.py", "expect_also": "b.py", "message": "m"}],
        "verify": {"extra_tests_for_source": {}, "why": ""}}
SCREENED = {"tasks": {"dev-1": {"list": "dev", "keep": ["t.py::T::a"], "exclude": ["t.py::T::x"], "dropped": False},
                      "dev-2": {"list": "dev", "keep": ["t.py::T::b"], "exclude": [], "dropped": False}}}
TABLE = {"screened": {"none": {"resolved": 1}}}


def run(d, task, arm, ok):
    r = {"task": task, "arm": arm, "seed": 1}
    p = batch.run_path(d / "runs", r)
    p.mkdir(parents=True)
    kept = "t.py::T::a" if task == "dev-1" else "t.py::T::b"
    g = {"f2p_passed": [kept] if ok else [], "f2p_failed": ([] if ok else [kept]) + ["t.py::T::x"] * (task == "dev-1"),
         "p2p_failed": [], "error": ""}
    (p / "result.json").write_text(json.dumps({"grade": g, "agent_end": ""}))
    (p / "hooks.jsonl").write_text(json.dumps({"fired": True, "detail": "co-change: warned"}) + "\n")
    return r


def plan(d):
    return {"runs": [run(d, "dev-1", "none", True), run(d, "dev-1", "both", False),
                     run(d, "dev-2", "none", True), run(d, "dev-2", "both", True)]}


def test_inputs_cover_tasks_where_arms_differed(tmp_path):
    inputs = tune.collect_inputs(tmp_path, plan(tmp_path), SPEC, SCREENED, TABLE, "notes", ["dev-1", "dev-2"], ["hold-1"])
    got = inputs["tasks_where_arms_differed"]
    assert list(got) == ["dev-1"] and got["dev-1"]["solved_by"] == ["none"]
    failed = got["dev-1"]["failed_runs"]["both"]
    assert [t["test"] for t in failed["failed_tests"]] == ["a"]  # the excluded test isn't reported
    assert failed["hook_messages"] == ["co-change: warned"] and inputs["findings"] == "notes"


def test_a_plan_with_a_non_dev_task_is_refused(tmp_path):
    with pytest.raises(ValueError, match="non-dev"):
        tune.collect_inputs(tmp_path, plan(tmp_path), SPEC, SCREENED, TABLE, "", ["dev-1"], [])


@pytest.mark.parametrize("hold", ["repo-4516", "repo-fresh-8e5e2557"])
def test_holdout_ids_in_inputs_are_refused(hold):
    with pytest.raises(ValueError, match="holdout"):
        tune.assert_dev_only({"findings": f"see {hold}"}, [hold])
    with pytest.raises(ValueError, match="holdout"):
        tune.assert_dev_only({"findings": f"see {hold.rsplit('-', 1)[-1]}"}, [hold]) if "fresh" in hold else \
            tune.assert_dev_only({"x": hold}, [hold])
    tune.assert_dev_only({"findings": "dev only"}, [hold])


def reply(**over):
    hooks = {"lint": {"keep": True, "note": "Fix lint first."}, "verify": {"keep": False, "note": ""},
             "cochange": {"keep": True, "rules": [{"if_edited": "a.py", "expect_also": "b.py", "message": "new words"}]}}
    return json.dumps({"agents_md": "# new\nrule", "hooks": hooks, "why": "w"} | over)


def test_parse_keeps_chosen_hooks_and_new_wording():
    tuned, checks, problems = tune.parse(reply(), SPEC)
    assert not problems and checks == ["lint", "cochange"]
    assert tuned["agents_md"] == "# new\nrule" and tuned["cochange"][0]["message"] == "new words"
    assert tuned["wording"] == {"lint": "Fix lint first.", "verify": ""}


@pytest.mark.parametrize("text, problem", [
    ("no json", "no JSON"),
    (reply(agents_md=""), "empty"),
    (reply(agents_md="x\n" * (gen.MAX_AGENTS_LINES + 1)), "lines"),
    (reply(hooks={"cochange": {"keep": True, "rules": [{"if_edited": "a.py", "expect_also": "z.py", "message": "m"}]}}),
     "not from the current setup"),
    (reply(hooks={"cochange": {"keep": True, "rules": []}}), "no rules"),
])
def test_parse_rejects_bad_output(text, problem):
    assert any(problem in p for p in tune.parse(text, SPEC)[2])


def test_render_writes_only_the_tuned_arm(tmp_path):
    (tmp_path / "both").mkdir()
    (tmp_path / "both" / "keep").write_text("x")
    tuned, checks, _ = tune.parse(reply(), SPEC)
    files = tune.render(tuned, checks, {"tests_for_source": {}}, tmp_path, feedback="additional_context", run_id="r1")
    assert "AGENTS.md" in files and (tmp_path / "both" / "keep").exists()
    cfg = json.loads((tmp_path / "tuned" / ".muse" / "uplift_hooks" / "config.json").read_text())
    assert cfg["checks"] == ["lint", "cochange"] and cfg["wording"]["lint"] == "Fix lint first."
    hooks = json.loads((tmp_path / "tuned" / ".muse" / "hooks.json").read_text())["hooks"]
    assert "Stop" not in hooks and "PostToolUse" in hooks
    assert json.loads((tmp_path / "tuned" / "MANIFEST.json").read_text())["generator_run"] == "r1"
    assert (tmp_path / "tuned" / "AGENTS.md").read_text() == "# new\nrule\n"
