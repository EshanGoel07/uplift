"""Grading: did the code in a workspace fix the bug without breaking anything?

The real fix's tests (``test_patch``) are hidden from the agent. At grading time
they're applied on top of whatever the agent did (test files are first reset to
the starting commit, so an agent can't pass by editing the tests), then:

* every FAIL_TO_PASS test must pass  -> the bug is fixed
* every PASS_TO_PASS test must pass  -> nothing that worked before broke

Pass/fail only. No AI judge.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import gitutil

_RESULT = re.compile(r"^(PASSED|FAILED|ERROR|XPASS|XFAIL|SKIPPED)\s+(\S+)", re.M)


@dataclass
class Grade:
    resolved: bool
    f2p_passed: list[str] = field(default_factory=list)
    f2p_failed: list[str] = field(default_factory=list)
    p2p_failed: list[str] = field(default_factory=list)      # regressions
    p2p_total: int = 0
    test_patch_applied: bool = True
    error: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def parse_pytest(output: str) -> dict[str, str]:
    """Map test node id -> outcome from `pytest -rA` short summary lines."""
    out: dict[str, str] = {}
    for status, nodeid in _RESULT.findall(output):
        nodeid = nodeid.split(" - ")[0]
        out[nodeid] = status
    return out


def _passed(status: str | None) -> bool:
    return status in ("PASSED", "XPASS")


def clear_bytecode(workspace: Path) -> None:
    """Delete __pycache__ outside the virtualenv. Python only checks source mtime+size, so a
    same-size edit within the same second would otherwise run the OLD code."""
    import shutil
    for d in workspace.rglob("__pycache__"):
        if ".venv" not in d.relative_to(workspace).parts:
            shutil.rmtree(d, ignore_errors=True)


def run_tests(workspace: Path, python: Path, test_ids: list[str], timeout: int = 900) -> tuple[dict[str, str], str]:
    """Run the given pytest node ids with the workspace's own interpreter."""
    if not test_ids:
        return {}, ""
    files = sorted({t.split("::")[0] for t in test_ids})
    clear_bytecode(workspace)
    cmd = [str(python), "-m", "pytest", "-rA", "--no-header", "--tb=line", "--color=no",
           "-p", "no:cacheprovider", "-W", "ignore::DeprecationWarning", *files]
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")  # stale .pyc can mask a code change
    proc = subprocess.run(cmd, cwd=workspace, capture_output=True, text=True, timeout=timeout, env=env)
    text = proc.stdout + "\n" + proc.stderr
    return parse_pytest(text), text


def reset_test_files(workspace: Path, base_commit: str, test_files: list[str]) -> None:
    """Put test files back to the starting commit, so agent edits to tests can't affect grading."""
    for f in test_files:
        if gitutil.git_ok(workspace, "cat-file", "-e", f"{base_commit}:{f}"):
            gitutil.git(workspace, "checkout", base_commit, "--", f)
        else:
            p = workspace / f
            if p.exists():
                p.unlink()


def grade(workspace: Path, python: Path, base_commit: str, test_patch: str, test_files: list[str],
          fail_to_pass: list[str], pass_to_pass: list[str], log_path: Path | None = None) -> Grade:
    reset_test_files(workspace, base_commit, test_files)
    if not gitutil.git_ok(workspace, "apply", "-", input=test_patch):
        return Grade(resolved=False, test_patch_applied=False, p2p_total=len(pass_to_pass),
                     error="hidden test patch did not apply")
    results, text = run_tests(workspace, python, fail_to_pass + pass_to_pass)
    if log_path:
        log_path.write_text(text)
    f2p_ok = [t for t in fail_to_pass if _passed(results.get(t))]
    f2p_bad = [t for t in fail_to_pass if not _passed(results.get(t))]
    p2p_bad = [t for t in pass_to_pass if not _passed(results.get(t))]
    return Grade(resolved=not f2p_bad and not p2p_bad, f2p_passed=f2p_ok, f2p_failed=f2p_bad,
                 p2p_failed=p2p_bad, p2p_total=len(pass_to_pass))
