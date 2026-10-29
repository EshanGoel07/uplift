"""mine-fresh on synthetic repos: candidate filter, patch split, F2P/P2P, issue-only statements."""

import pytest

from uplift import mine, split
from uplift.mine import Commit

from .test_core import commit, repo, sh  # noqa: F401 (repo is a fixture)

SETUP_PY = "from setuptools import setup\nsetup(name='pkg', version='0.1', packages=['pkg'])\n"
BUGGY = "def add(a, b):\n    return a - b\n\n\ndef mul(a, b):\n    return a * b\n"
FIXED = BUGGY.replace("a - b", "a + b")
OLD_TESTS = "from pkg.calc import mul\n\n\ndef test_mul():\n    assert mul(2, 3) == 6\n"
NEW_TESTS = OLD_TESTS + (
    "\n\ndef test_add():\n    from pkg.calc import add\n    assert add(2, 3) == 5\n"
    "\n\ndef test_broken():\n    assert False\n"          # fails before AND after: neither F2P nor P2P
    "\n\ndef test_new_ok():\n    assert 1 + 1 == 2\n"     # new but passes before: P2P
)


CLOSED_AT = {7: "2026-01-05T01:00:00Z", 8: "2026-02-05T01:00:00Z"}   # an hour after their commits


def issue(number, kind="issues", created="2025-11-30T00:00:00Z", closed=None, closed_by=()):
    return {"title": f"Issue {number}", "body": "add() is wrong",
            "url": f"https://github.com/o/r/{kind}/{number}", "createdAt": created,
            "closedAt": closed or CLOSED_AT.get(number),
            "closedByPullRequestsReferences": [{"number": n} for n in closed_by]}


@pytest.fixture
def history(repo):
    """A base commit, then one commit per filter case (oldest -> newest)."""
    base = commit(repo, {"pkg/__init__.py": "", "pkg/calc.py": BUGGY, "setup.py": SETUP_PY,
                         "tests/test_calc.py": OLD_TESTS, "README.md": "r\n"}, "init", "2025-12-01T00:00:00+00:00")
    good = commit(repo, {"pkg/calc.py": FIXED, "tests/test_calc.py": NEW_TESTS, "tests/fixtures/q.sql": "SELECT 1\n",
                         "README.md": "r2\n"}, "fix(calc): add adds\n\ncloses #7", "2026-01-05T00:00:00+00:00")
    cases = [
        ({"pkg/a.py": "1\n", "tests/test_a.py": "1\n"}, "feat: new thing closes #1"),
        ({"README.md": "r3\n", "tests/test_a.py": "2\n"}, "fix: docs closes #2"),
        ({"pkg/a.py": "2\n", "tests/test_a.py": "3\n"}, "fix(calc): no issue (#9)"),
        ({"pkg/a.py": "3\n"}, "Fix: library only closes #3"),
        ({"pkg/a.py": "4\n", "tests/test_a.py": "4\n"}, "fix: linked to a PR closes #8"),
        ({**{f"pkg/m{i}.py": "x\n" for i in range(6)}, "tests/test_a.py": "5\n"}, "fix: too big closes #4"),
    ]
    for i, (files, msg) in enumerate(cases):
        commit(repo, files, msg, f"2026-02-{i + 1:02d}T00:00:00+00:00")
    return repo, base, good


def test_filter_reason():
    c = lambda subject, files: Commit("s", "p", "d", subject, "", files)  # noqa: E731
    ok = ["sqlglot/parser.py", "tests/test_parser.py"]
    assert mine.filter_reason(c("fix(parser): x", ok)) is None
    assert mine.filter_reason(c("Fix: x", ok)) is None
    assert mine.filter_reason(c("fix(snowflake)!: x", ok)) is None
    assert mine.filter_reason(c("feat: x", ok)) == "subject is not a fix"
    assert mine.filter_reason(c("fixup something", ok)) == "subject is not a fix"
    assert mine.filter_reason(c("fix: x", ["tests/test_a.py", "docs/a.py"])) == "no library .py change"
    assert mine.filter_reason(c("fix: x", ["sqlglot/a.py", "tests/fixtures/a.sql"])) == "no test .py change"
    many = [f"sqlglot/m{i}.py" for i in range(6)] + ["tests/test_a.py"]
    assert mine.filter_reason(c("fix: x", many)) == "more than 5 library files"
    assert mine.filter_reason(c("fix: x", many[1:])) is None


def test_linked_issue():
    assert mine.linked_issue("fix(oracle): keep month end closes #8824 [CLAUDE] (#8825)", "") == 8824
    assert mine.linked_issue("fix(x): y (#8831)", "") is None          # PR number, not an issue link
    assert mine.linked_issue("fix: y", "Fixes https://github.com/o/r/issues/12") == 12
    assert mine.linked_issue("fix: y", "Resolves o/r#13") == 13
    assert mine.linked_issue("fix(parser): y", "body without refs") is None


def test_issue_must_be_tied_to_the_commit():
    landed = "2026-09-14T10:00:00+00:00"
    # Real case (sqlglot e27b7654): a fork's squashed PR said "Fixes #54"; upstream #54 is a 2021 issue.
    stale = issue(54, created="2021-11-10T11:09:43Z", closed="2021-11-10T18:36:51Z")
    assert mine.problem_statement("o/r", 54, lambda r, n: stale, landed, 8321) == \
        (None, "issue not tied to this commit (closed at another time, not by its PR)")
    # Closed right when the commit landed: accepted.
    fresh = issue(8343, created="2026-09-12T00:00:00Z", closed="2026-09-14T10:05:00Z")
    assert mine.problem_statement("o/r", 8343, lambda r, n: fresh, landed, 8344)[0].startswith("Issue 8343")
    # Closed by hand weeks before the PR merged, but the issue names the PR as its closer: accepted.
    early = issue(7438, created="2026-04-01T00:00:00Z", closed="2026-04-02T00:00:00Z", closed_by=[7640])
    assert mine.problem_statement("o/r", 7438, lambda r, n: early, landed, 7640)[0]
    # Opened after the commit: rejected.
    later = issue(9000, created="2026-09-20T00:00:00Z", closed="2026-09-20T01:00:00Z")
    assert mine.problem_statement("o/r", 9000, lambda r, n: later, landed, 1)[0] is None
    assert mine.pr_number("fix(x): y [CLAUDE] (#8321)") == 8321 and mine.pr_number("fix: y") is None


def test_patch_and_test_patch_split(history):
    repo, base, good = history
    patch, test_patch = mine.split_patches(repo, base, good)
    assert mine.files_in_patch(patch) == ["README.md", "pkg/calc.py"]
    assert mine.files_in_patch(test_patch) == ["tests/fixtures/q.sql", "tests/test_calc.py"]
    assert mine.test_modules(test_patch) == ["tests/test_calc.py"]     # fixtures aren't run directly
    wt = repo.parent / "wt"
    sh(repo, "worktree", "add", "-q", "--detach", str(wt), base)
    assert mine.gitutil.patch_applies(wt, patch) and mine.gitutil.patch_applies(wt, test_patch)


def test_f2p_p2p_rule():
    before = {"a": "FAILED", "b": "PASSED", "c": "FAILED", "d": "ERROR", "e": "PASSED"}
    after = {"a": "PASSED", "b": "PASSED", "c": "FAILED", "d": "PASSED", "e": "FAILED", "new": "PASSED"}
    f2p, p2p = mine.f2p_p2p(before, after)
    assert f2p == ["a", "d"]
    assert p2p == ["b"]          # "e" regressed, "new" never ran before: neither


def test_measure_runs_real_tests(history, tmp_path):
    repo, base, good = history
    patch, test_patch = mine.split_patches(repo, base, good)
    f2p, p2p, why = mine.measure(repo, base, patch, test_patch, tmp_path / "ws", extras=None)
    assert why == ""
    assert f2p == ["tests/test_calc.py::test_add"]
    assert p2p == ["tests/test_calc.py::test_mul", "tests/test_calc.py::test_new_ok"]
    assert not (tmp_path / "ws").exists(), "measure workspace is cleaned up"


def test_mine_filters_and_skips_without_issue(history, tmp_path, monkeypatch):
    repo, base, good = history
    calls = []

    def fake_gh(r, n):
        calls.append(n)
        return issue(n, "pull" if n == 8 else "issues")

    monkeypatch.setattr(mine, "gh_issue", fake_gh)
    measured = []

    def fake_measure(clone, parent, patch, test_patch, ws, **kw):
        measured.append(parent)
        return ["tests/test_calc.py::test_add"], ["tests/test_calc.py::test_mul"], ""

    tasks, stats = mine.mine("o/r", repo, "2026-01-01", 10, tmp_path / "ws", workers=2, lib_prefix="pkg/",
                             branch="main", measure_fn=fake_measure)
    assert [t.base_commit for t in tasks] == [base] and measured == [base]
    t = tasks[0]
    assert t.id == f"o__r-fresh-{good[:8]}" and t.source == "mined"
    assert t.created_at.startswith("2026-01-05")
    assert t.problem_statement == "Issue 7\n\nadd() is wrong"
    assert "a + b" not in t.problem_statement and "fix(calc)" not in t.problem_statement
    assert calls == [8, 7]                          # gh is only asked about commits that link an issue
    assert stats.skipped == {"subject is not a fix": 1, "no library .py change": 1, "no linked issue": 1,
                             "no test .py change": 1, "linked number is a pull request, not an issue": 1,
                             "more than 5 library files": 1}
    assert stats.scanned == 7 and stats.accepted == 1


def test_mine_drops_candidates_without_f2p_and_respects_limit(history, tmp_path):
    repo, *_ = history
    no_f2p = lambda *a, **k: ([], ["x"], "no FAIL_TO_PASS test")  # noqa: E731
    tasks, stats = mine.mine("o/r", repo, "2026-01-01", 10, tmp_path / "ws", lib_prefix="pkg/", branch="main",
                             fetch_issue=lambda r, n: issue(n), measure_fn=no_f2p)
    assert tasks == [] and stats.skipped["no FAIL_TO_PASS test"] == 2   # the good one and the PR-linked one
    ok = lambda *a, **k: (["t"], [], "")  # noqa: E731
    tasks, stats = mine.mine("o/r", repo, "2026-01-01", 1, tmp_path / "ws", lib_prefix="pkg/", branch="main",
                             fetch_issue=lambda r, n: issue(n), measure_fn=ok)
    assert len(tasks) == 1 and "linked to a PR" in tasks[0].meta["subject"]  # newest first


def test_fresh_split_and_leakage(history, tmp_path):
    repo, base, good = history
    patch, test_patch = mine.split_patches(repo, base, good)
    t = mine.Task(id="f1", repo="o/r", source="mined", created_at="2026-01-05T00:00:00+00:00", base_commit=base,
                  problem_statement="", patch=patch, test_patch=test_patch, fail_to_pass=["x"], pass_to_pass=[])
    s = split.Split(repo="o/r", test_ids=[], dev_ids=[], unused_ids=[], cutoff="2024-01-01T00:00:00+00:00")
    split.attach_fresh(s, [t], repo, tmp_path / "wt")
    assert s.fresh_ids == ["f1"] and s.fresh_cutoff == t.created_at
    assert s.fresh_snapshot_commit == base           # last commit >= 1 day before the fix
    assert s.fresh_leakage == {"f1": []} and s.leak_free
    # Positive control: against the fix commit itself, the leak is detected.
    assert split.leakage_at(good, ["f1"], [t], repo, tmp_path / "wt")["f1"]
