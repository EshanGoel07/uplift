"""Screening: which lines belong to which F2P test, the keep/exclude/drop rule, and resolved on the
screened lists. A fake model stands in for Muse Spark."""

import json
from pathlib import Path

from uplift import runner, screen
from uplift.screen import PatchedFile, apply_hunks, lines_for_test, parse_hunks

from .test_runner import calc, fake_agent  # noqa: F401

BASE = "class T:\n    def test_a(self):\n        check(1)\n\n    def test_b(self):\n        check(2)\n"
PATCH = """diff --git a/tests/test_x.py b/tests/test_x.py
--- a/tests/test_x.py
+++ b/tests/test_x.py
@@ -1,6 +1,8 @@
 class T:
     def test_a(self):
         check(1)
+        check("for a")
 
     def test_b(self):
         check(2)
+        check("for b")
"""
FIXTURE = """diff --git a/tests/fixtures/identity.sql b/tests/fixtures/identity.sql
--- a/tests/fixtures/identity.sql
+++ b/tests/fixtures/identity.sql
@@ -1 +1,2 @@
 SELECT 1
+SELECT 2
"""
TEST_FILE = "tests/test_x.py"


def files(patch=PATCH, base=BASE):
    return {p: apply_hunks(base, h) for p, h in parse_hunks(patch).items()}


def test_added_lines_go_to_the_test_they_are_in():
    """One hunk spans both tests: a hunk header alone would give both lines to test_a."""
    f = files()
    assert lines_for_test(f"{TEST_FILE}::T::test_a", f) == (['        check("for a")'], "test")
    assert lines_for_test(f"{TEST_FILE}::T::test_b", f) == (['        check("for b")'], "test")


def test_apply_hunks_rebuilds_the_file():
    got = files()[TEST_FILE]
    assert "\n".join(got.lines) == BASE.replace('check(1)\n', 'check(1)\n        check("for a")\n') \
        .replace('check(2)\n', 'check(2)\n        check("for b")\n')
    assert got.added[got.lines.index('        check("for a")') + 1] == '        check("for a")'


def test_a_test_with_no_lines_of_its_own_gets_fixture_and_helper_lines():
    f = {TEST_FILE: PatchedFile(["class T:", "    def test_a(self):", "        x()", "    def helper(self):", "        y()"],
                                {5: "        y()"}),
         "tests/fixtures/identity.sql": apply_hunks("SELECT 1", parse_hunks(FIXTURE)["tests/fixtures/identity.sql"])}
    assert lines_for_test(f"{TEST_FILE}::T::test_a", f) == (["        y()", "SELECT 2"], "shared")
    assert lines_for_test("tests/other.py::O::test_o", {}) == ([], "none")


def test_prompt_holds_only_the_issue_and_the_lines():
    msgs, cut = screen.build_messages("issue text", ["+line"])
    user = msgs[1]["content"]
    assert not cut and "issue text" in user and "+line" in user and screen.QUESTION in user
    stripped = user.replace("issue text", "").replace("+line", "").replace(screen.QUESTION, "").replace(screen.FORMAT, "")
    assert stripped.split() == ["<issue>", "</issue>", "<added_test_lines>", "</added_test_lines>"]
    assert screen.build_messages("i", ["x" * (screen.MAX_LINES_CHARS + 1)])[1]


def test_parse_verdict():
    assert screen.parse_verdict('ok {"verdict": "Partly", "reason": "r"}') == ("partly", "r")
    assert screen.parse_verdict('{"verdict": "maybe"}') is None
    assert screen.parse_verdict("") is None and screen.parse_verdict(None) is None


def verdict(v):
    return {"choices": [{"message": {"content": json.dumps({"verdict": v, "reason": "r"})}}]}


def item(task="t1", test=f"{TEST_FILE}::T::test_a"):
    return {"list": "dev", "task": task, "test": test, "source": "test", "lines": ["x"], "cut": False,
            "messages": [{"role": "user", "content": "q"}]}


def test_judge_saves_everything_and_resumes_without_paying_twice(tmp_path):
    calls = []

    def call(messages, max_tokens):
        calls.append(max_tokens)
        return verdict("no")

    rec = screen.judge(item(), tmp_path, call)
    assert rec["verdict"] == "no" and rec["messages"] and rec["response"]
    assert screen.judge(item(), tmp_path, call)["verdict"] == "no" and len(calls) == 1


def test_judge_retries_then_refuses_to_guess(tmp_path):
    calls = []

    def call(messages, max_tokens):
        calls.append(max_tokens)
        return {"choices": [{"message": {"content": ""}}]}

    results = screen.run([item()], tmp_path, call)
    assert "failed" in results[0] and calls == [screen.MAX_TOKENS, 2 * screen.MAX_TOKENS]
    assert not list(tmp_path.rglob("*.json"))


def test_rule_keeps_yes_partly_unjudged_excludes_no_drops_empty():
    js = [{"list": "dev", "task": "a", "test": "a1", "verdict": "yes"},
          {"list": "dev", "task": "a", "test": "a2", "verdict": "no"},
          {"list": "dev", "task": "b", "test": "b1", "verdict": "partly"},
          {"list": "dev", "task": "c", "test": "c1", "verdict": "no"},
          {"list": "dev", "task": "d", "test": "d1", "verdict": "unjudged"}]
    t = screen.apply_rule(js)
    assert t["a"] == {"list": "dev", "keep": ["a1"], "exclude": ["a2"], "dropped": False}
    assert t["b"]["keep"] == ["b1"] and t["c"]["dropped"] and not t["d"]["dropped"]
    s = screen.summary({"tasks": t})["dev"]
    assert (s["tasks"], s["kept"], s["dropped"], s["tests"], s["excluded"]) == (4, 3, 1, 5, 2)


def test_resolved_on_screened_lists():
    g = {"f2p_passed": ["a"], "f2p_failed": ["b"], "p2p_failed": [], "error": "", "test_patch_applied": True}
    assert not screen.resolved(g, [])
    assert screen.resolved(g, ["b"])
    assert not screen.resolved(g, ["a", "b"])                      # no F2P test left
    assert not screen.resolved(dict(g, p2p_failed=["c"]), ["b"])   # regressions always count
    assert not screen.resolved(dict(g, error="pytest output check failed"), ["b"])
    assert not screen.resolved({}, []) and not screen.resolved(None, [])


def test_paired():
    rows = {("t1", 1): {"none": True, "x": False}, ("t2", 1): {"none": False, "x": True},
            ("t3", 1): {"none": True, "x": False}}
    assert screen.paired(rows, ["none", "x"])["x"] == {"resolved": 1, "tasks": 3, "wins": 1, "losses": 2}


def test_excluded_test_does_not_count_but_stays_in_the_raw_grade(calc, tmp_path):  # noqa: F811
    clone, t = calc
    res = runner.attempt(t, clone, tmp_path / "ws", tmp_path / "run", arm="x", setup_dir=None, seed=1,
                         guard=Path("/nonexistent"), agent_cmd=fake_agent(tmp_path, "pass\n"),
                         excluded_f2p=[])
    assert not res.resolved
    t2 = type(t)(**{**t.__dict__, "fail_to_pass": t.fail_to_pass + ["tests/test_calc.py::test_mul"],
                    "pass_to_pass": []})
    agent = fake_agent(tmp_path, "pathlib.Path('calc.py').write_text(pathlib.Path('calc.py').read_text()"
                                 ".replace('a - b','a + b').replace('a * b','a / b'))\n")
    res = runner.attempt(t2, clone, tmp_path / "ws", tmp_path / "run2", arm="x", setup_dir=None, seed=1,
                         guard=Path("/nonexistent"), agent_cmd=agent, excluded_f2p=["tests/test_calc.py::test_mul"])
    assert res.resolved and res.grade["f2p_failed"] == ["tests/test_calc.py::test_mul"]
    assert res.grade["resolved"] is False and res.f2p_excluded == ["tests/test_calc.py::test_mul"]
