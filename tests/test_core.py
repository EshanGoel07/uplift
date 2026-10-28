"""Unit tests on tiny synthetic git repos (no network, no model calls)."""

import subprocess
from pathlib import Path

import pytest

from uplift import gitutil, risk, split
from uplift.tasks import Task, files_in_patch


def sh(repo: Path, *args: str, date: str | None = None) -> str:
    env = None
    if date:
        import os
        env = dict(os.environ, GIT_AUTHOR_DATE=date, GIT_COMMITTER_DATE=date)
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True,
                          text=True, env=env).stdout


def commit(repo: Path, files: dict[str, str], msg: str, date: str) -> str:
    for path, content in files.items():
        p = repo / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        sh(repo, "add", path)
    sh(repo, "commit", "-q", "-m", msg, date=date)
    return sh(repo, "rev-parse", "HEAD").strip()


@pytest.fixture
def repo(tmp_path):
    r = tmp_path / "r"
    r.mkdir()
    sh(r, "init", "-q", "-b", "main")
    sh(r, "config", "user.email", "t@t")
    sh(r, "config", "user.name", "t")
    return r


def test_files_in_patch():
    patch = ("diff --git a/pkg/a.py b/pkg/a.py\n--- a/pkg/a.py\n+++ b/pkg/a.py\n@@ -1 +1 @@\n-x\n+y\n"
             "diff --git a/tests/test_a.py b/tests/test_a.py\n")
    assert files_in_patch(patch) == ["pkg/a.py", "tests/test_a.py"]


def _task(i, date, patch=""):
    return Task(id=f"t{i}", repo="o/r", source="test", created_at=date, base_commit="x",
                problem_statement="", patch=patch, test_patch="", fail_to_pass=["t"], pass_to_pass=[])


def test_split_is_chronological():
    tasks = [_task(i, f"2024-01-{i + 1:02d}T00:00:00+00:00") for i in range(10)]
    s = split.make_split(list(reversed(tasks)), test_n=3, dev_n=3)
    assert s.test_ids == ["t7", "t8", "t9"]
    assert s.dev_ids == ["t4", "t5", "t6"]
    assert s.cutoff.startswith("2024-01-08")


def test_leakage_check_detects_fix_in_snapshot(repo):
    base = commit(repo, {"pkg/a.py": "x = 1\n"}, "init", "2024-01-01T00:00:00+00:00")
    fix = commit(repo, {"pkg/a.py": "x = 2\n"}, "fix: x", "2024-01-05T00:00:00+00:00")
    patch = sh(repo, "diff", base, fix)
    later = _task(1, "2024-01-10T00:00:00+00:00", patch)

    s = split.Split(repo="o/r", test_ids=["t1"], dev_ids=[], unused_ids=[], cutoff=later.created_at)
    # Snapshot AFTER the fix: leakage must be reported
    s.snapshot_commit = fix
    split.check_leakage(s, [later], repo, repo.parent / "wt")
    assert not s.leak_free and "fix already present" in s.leakage["t1"][0]
    # Snapshot BEFORE the fix: clean
    s.snapshot_commit = base
    split.check_leakage(s, [later], repo, repo.parent / "wt")
    assert s.leak_free


def test_snapshot_is_before_cutoff(repo):
    commit(repo, {"a.py": "1\n"}, "one", "2024-01-01T00:00:00+00:00")
    c2 = commit(repo, {"a.py": "2\n"}, "two", "2024-01-03T00:00:00+00:00")
    commit(repo, {"a.py": "3\n"}, "three", "2024-01-10T00:00:00+00:00")
    s = split.Split(repo="o/r", test_ids=[], dev_ids=[], unused_ids=[], cutoff="2024-01-08T00:00:00+00:00")
    split.attach_snapshot(s, repo, margin_days=1)
    assert s.snapshot_commit == c2


def test_fix_detection():
    assert risk.Commit("x", None, "a", "fix(oracle): keep month end closes #8824").is_fix
    assert risk.Commit("x", None, "a", "Fix: crash on empty input").is_fix
    assert not risk.Commit("x", None, "a", "feat: add prefix support").is_fix
    assert not risk.Commit("x", None, "a", "docs: prefix examples").is_fix


def test_risk_map_cochange_and_test_mapping(repo):
    d = 1
    for i in range(6):  # dialect file and its test always change together
        commit(repo, {"pkg/dialects/foo.py": f"v{i}\n", "tests/test_foo.py": f"t{i}\n"},
               f"fix(foo): bug {i}", f"2024-01-{d:02d}T00:00:00+00:00")
        d += 1
    for i in range(3):
        commit(repo, {"pkg/util.py": f"u{i}\n"}, f"chore: tidy {i}", f"2024-01-{d:02d}T00:00:00+00:00")
        d += 1
    head = sh(repo, "rev-parse", "HEAD").strip()
    r = risk.build_risk_map(repo, head, source_prefix="pkg/", szz_limit=0, min_support=3)
    assert r["files"][0]["path"] == "pkg/dialects/foo.py"           # fixes make it riskiest
    assert r["tests_for_source"]["pkg/dialects/foo.py"] == ["tests/test_foo.py"]
    assert r["fix_commits"] == 6
