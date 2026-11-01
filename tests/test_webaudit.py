"""The network audit, on made-up tool calls."""

from pathlib import Path

from uplift import webaudit
from uplift.tasks import Task


def call(url, name="muse.web_fetch", output="page text"):
    return {"name": name, "args": '{"url": "%s"}' % url, "output": output}


def tier(calls, pr="4331", sha="", future=lambda c: True):
    return webaudit.classify(calls, pr, sha, future)["tier"]


def test_own_fix_diff_is_tier_1_in_every_form():
    for url in ("https://github.com/tobymao/sqlglot/pull/4331.diff", "https://github.com/tobymao/sqlglot/pull/4331.patch",
                "https://github.com/tobymao/sqlglot/pull/4331/files",
                "https://patch-diff.githubusercontent.com/raw/tobymao/sqlglot/pull/4331.diff"):
        assert tier([call(url)]) == 1, url


def test_shell_curl_counts_like_a_web_tool():
    c = {"name": "muse.bash", "args": '{"command":"curl -sL https://github.com/tobymao/sqlglot/pull/4331.diff | head"}',
         "output": '{"exit_code": 0, "output": "diff --git"}'}
    assert tier([c]) == 1


def test_own_page_and_another_pr_are_lower_tiers():
    assert tier([call("https://github.com/tobymao/sqlglot/pull/4331")]) == 3
    assert tier([call("https://github.com/tobymao/sqlglot/issues/4331")]) == 3
    assert tier([call("https://github.com/tobymao/sqlglot/pull/43310")]) == 4    # not a prefix match
    assert tier([call("https://github.com/tobymao/sqlglot/pull/4285")]) == 4


def test_upstream_code_and_commits_by_history():
    assert tier([call("https://raw.githubusercontent.com/tobymao/sqlglot/main/sqlglot/parser.py")]) == 2
    url = "https://github.com/tobymao/sqlglot/commit/3edd14005cc3"
    assert tier([call(url)], future=lambda c: True) == 2
    assert tier([call(url)], future=lambda c: False) == 4


def test_fresh_fix_commit_is_own_fix():
    url = "https://github.com/tobymao/sqlglot/commit/13a570c6f790"
    assert tier([call(url)], pr=None, sha="13a570c6f790a6140c9c") == 1


def test_docs_failed_fetches_and_other_tools_stay_clean():
    assert tier([call("https://duckdb.org/docs/sql/statements/unpivot")]) == 5
    assert tier([call("https://github.com/tobymao/sqlglot/pull/4331.diff", output="Sign in to GitHub")]) == 5
    assert tier([call("https://github.com/tobymao/sqlglot/pull/4331.diff", output="")]) == 5
    assert tier([call("https://github.com/tobymao/sqlglot/pull/4331.diff", name="muse.read_file")]) == 5


def test_a_later_clean_call_does_not_lower_the_tier():
    assert tier([call("https://github.com/tobymao/sqlglot/pull/4331.diff"), call("https://duckdb.org/x")]) == 1


def test_pip_sqlglot_is_upstream_code_but_local_install_is_not():
    pip = {"name": "muse.bash", "args": '{"command":"pip install sqlglot==26.0"}', "output": "ok"}
    other = {"name": "muse.bash", "args": '{"command":"pip install ruff"}', "output": "ok"}
    assert tier([pip]) == 2
    assert tier([other]) == 5


def test_ran_tests_comes_from_shell_commands_only():
    bash = {"name": "muse.bash", "args": '{"command":".venv/bin/python -m pytest tests/x.py"}', "output": "ok"}
    read = {"name": "muse.read_file", "args": '{"path":"tests/pytest_notes.md"}', "output": "ok"}
    snippet = {"name": "muse.bash", "args": '{"command":"python -c \'print(1)\'"}', "output": "ok"}
    assert webaudit.classify([bash], "1", "", None)["ran_tests"] is True
    assert webaudit.classify([read, snippet], "1", "", None)["ran_tests"] is False


def test_fix_pr_for_both_task_sources():
    swe = Task(id="tobymao__sqlglot-4331", repo="r", source="s", created_at="", base_commit="b", problem_statement="",
               patch="", test_patch="", fail_to_pass=[], pass_to_pass=[])
    assert webaudit.fix_pr(swe) == "4331"
    fresh = Task(id="tobymao__sqlglot-fresh-13a570c6", repo="r", source="mined", created_at="", base_commit="b",
                 problem_statement="", patch="", test_patch="", fail_to_pass=[], pass_to_pass=[],
                 meta={"subject": "fix(oracle): x closes #8824 [CLAUDE] (#8825)"})
    assert webaudit.fix_pr(fresh) == "8825"


def test_sensitivity_counts_exposed_runs_as_failed(tmp_path):
    from uplift.analysis import Batch
    results = {(t, a, s): {"resolved": True} for t in ("t1", "t2") for a in ("none", "x") for s in (1, 2)}
    b = Batch(["t1", "t2"], ["none", "x"], [1, 2], {"t1": "test", "t2": "test"}, results)
    rows = [{"task": t, "arm": a, "seed": s, "tier": 1 if (t, a, s) == ("t1", "x", 1) else 5}
            for t, a, s in results]
    views = webaudit.sensitivity(b, rows)
    assert [v["tasks"] for v in views] == [2, 1, 1, 2]
    assert views[0]["arms"]["x"]["diff"] == 0
    assert views[3]["arms"]["x"]["diff"] == -0.25
