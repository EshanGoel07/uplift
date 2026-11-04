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


# A sub-test entry: `SUB<STATUS>[<msg>] <path>.py::<test> ...`, or `SUB<STATUS>(<k>=<v>, ...)`
# when the sub-test is labelled by keyword arguments (or both: `[<msg>] (<k>=<v>)`). The label
# can span many lines (sqlglot labels sub-tests with multi-line SQL), so the node id may be lines
# further down. The label ends at the first `] <path>.py::...` / `) <path>.py::...`, and never
# runs into the next entry.
_SUB = re.compile(r"^SUB(\w+)[\[(](?:(?!^SUB\w+[\[(]).)*?[\])]\s+(\S+\.py::\S+)[^\n]*", re.M | re.S)
_SUB_START = re.compile(r"^SUB\w+[\[(]", re.M)
_SUMMARY = re.compile(r"^=+ (.*?) in [\d.]+s(?: \([^)]*\))? =+$", re.M)


def _scan(output: str) -> tuple[dict[str, str], dict[str, int], int]:
    """(results, counts of each status line, number of sub-test entries left unparsed)."""
    subs = _SUB.findall(output)
    unparsed = len(_SUB_START.findall(output)) - len(subs)
    rest = _SUB.sub("", output)            # so label text can't be read as a result line
    out: dict[str, str] = {}
    counts: dict[str, int] = {}
    for status, nodeid in _RESULT.findall(rest):
        out[nodeid.split(" - ")[0]] = status
        counts[status] = counts.get(status, 0) + 1
    for status, nodeid in subs:
        counts["SUB" + status] = counts.get("SUB" + status, 0) + 1
        if status == "FAILED":
            out[nodeid] = "FAILED"
    return out, counts, unparsed


def parse_pytest(output: str) -> dict[str, str]:
    """Map test node id -> outcome from `pytest -rA` short summary lines.

    Sub-tests (unittest `subTest`, used heavily by sqlglot): newer pytest reports a failing
    sub-test on its own `SUBFAILED[<msg>] <nodeid>` entry and STILL prints `PASSED <nodeid>`
    for the parent. Any failing sub-test therefore marks its parent test as FAILED.
    """
    return _scan(output)[0]


def summary_counts(output: str) -> dict[str, int] | None:
    """Counts from pytest's final `=== 1 failed, 38 passed in 1.05s ===` line, or None."""
    lines = _SUMMARY.findall(output)
    if not lines:
        return None
    counts: dict[str, int] = {}
    for part in lines[-1].split(","):
        m = re.match(r"\s*(\d+) ([a-z][a-z ]*?)\s*$", part)
        if m:
            counts[m.group(2)] = counts.get(m.group(2), 0) + int(m.group(1))
    return counts


def check_output(output: str) -> str:
    """Cross-check the parsed result lines against pytest's own summary. Returns a problem
    description, or "" if they agree. Any problem means the run can't be graded (fail closed):
    a mis-parse must never turn a failure into a pass."""
    summary = summary_counts(output)
    if summary is None:
        return "no pytest summary line (crash or timeout?)"
    _, n, unparsed = _scan(output)
    if unparsed:
        return f"{unparsed} sub-test entr{'y' if unparsed == 1 else 'ies'} without a test id"
    if "subtests failed" in summary:       # some pytest versions count sub-test failures apart
        failed = [(n.get("FAILED", 0), summary.get("failed", 0)),
                  (n.get("SUBFAILED", 0), summary["subtests failed"])]
    else:                                  # pytest 9: each failing sub-test counts in `failed`
        failed = [(n.get("FAILED", 0) + n.get("SUBFAILED", 0), summary.get("failed", 0))]
    checks = failed + [(n.get("ERROR", 0), summary.get("error", 0) + summary.get("errors", 0)),
                       (n.get("PASSED", 0), summary.get("passed", 0))]
    if any(parsed != reported for parsed, reported in checks):
        return f"parsed {n} disagrees with pytest summary {summary}"
    return ""


def _passed(status: str | None) -> bool:
    return status in ("PASSED", "XPASS")


def clear_bytecode(workspace: Path) -> None:
    """Delete __pycache__ outside the virtualenv. Python only checks source mtime+size, so a
    same-size edit within the same second would otherwise run the OLD code."""
    import shutil
    for d in workspace.rglob("__pycache__"):
        if ".venv" not in d.relative_to(workspace).parts:
            shutil.rmtree(d, ignore_errors=True)


_CONFIGS = [("pytest.ini", None), (".pytest.ini", None), ("pyproject.toml", ("[tool.pytest.ini_options]", "[tool.pytest]")),
            ("tox.ini", ("[pytest]",)), ("setup.cfg", ("[tool:pytest]",))]


def pytest_config(workspace: Path) -> str:
    """The workspace's own pytest config file (pytest's lookup order), else an empty one."""
    for name, sections in _CONFIGS:
        p = workspace / name
        if p.is_file() and (sections is None or any(s in p.read_text(errors="replace") for s in sections)):
            return str(p)
    return os.devnull


def run_tests(workspace: Path, python: Path, test_ids: list[str], timeout: int = 900) -> tuple[dict[str, str], str]:
    """Run the given pytest node ids with the workspace's own interpreter."""
    if not test_ids:
        return {}, ""
    files = sorted({t.split("::")[0] for t in test_ids})
    clear_bytecode(workspace)
    # Workspace only: pytest would otherwise walk up from the workspace and pick up a parent
    # directory's config (uplift's own pyproject.toml) and conftest.py files.
    ws = str(Path(workspace).resolve())
    cmd = [str(python), "-m", "pytest", "-rA", "--no-header", "--tb=line", "--color=no",
           "-p", "no:cacheprovider", "-W", "ignore::DeprecationWarning",
           f"--rootdir={ws}", "-c", pytest_config(Path(ws)), f"--confcutdir={ws}", *files]
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")  # stale .pyc can mask a code change
    try:
        proc = subprocess.run(cmd, cwd=workspace, capture_output=True, text=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired as e:  # no summary line, so check_output fails it
        out = e.stdout.decode(errors="replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
        text = out + f"\nUPLIFT: pytest timed out after {timeout}s\n"
        return parse_pytest(text), text
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
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(text)
    problem = check_output(text)
    if problem:  # ERROR, never PASS: nothing counts as passed when the output can't be trusted
        return Grade(resolved=False, f2p_failed=list(fail_to_pass), p2p_failed=list(pass_to_pass),
                     p2p_total=len(pass_to_pass), error=f"pytest output check failed: {problem}")
    f2p_ok = [t for t in fail_to_pass if _passed(results.get(t))]
    f2p_bad = [t for t in fail_to_pass if not _passed(results.get(t))]
    p2p_bad = [t for t in pass_to_pass if not _passed(results.get(t))]
    return Grade(resolved=not f2p_bad and not p2p_bad, f2p_passed=f2p_ok, f2p_failed=f2p_bad,
                 p2p_failed=p2p_bad, p2p_total=len(pass_to_pass))
