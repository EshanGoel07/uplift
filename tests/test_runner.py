"""End-to-end runner tests on a synthetic repo with a real bug, a real fix and real
pytest tests. A tiny fake 'agent' script stands in for Muse Code (no model calls)."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from uplift import grade, runner, workspace
from uplift.tasks import Task, files_in_patch

from .test_core import commit, sh

BUGGY = "def add(a, b):\n    return a - b\n\n\ndef mul(a, b):\n    return a * b\n"
FIXED = "def add(a, b):\n    return a + b\n\n\ndef mul(a, b):\n    return a * b\n"
SETUP_PY = "from setuptools import setup\nsetup(name='calc', version='0.1', py_modules=['calc'])\n"
OLD_TESTS = "from calc import mul\n\ndef test_mul():\n    assert mul(2, 3) == 6\n"
NEW_TESTS = OLD_TESTS + "\nfrom calc import add\n\ndef test_add():\n    assert add(2, 3) == 5\n"


@pytest.fixture(scope="module")
def calc(tmp_path_factory):
    repo = tmp_path_factory.mktemp("calc")
    sh(repo, "init", "-q", "-b", "main")
    sh(repo, "config", "user.email", "t@t")
    sh(repo, "config", "user.name", "t")
    base = commit(repo, {"calc.py": BUGGY, "setup.py": SETUP_PY, "tests/test_calc.py": OLD_TESTS},
                  "init", "2024-01-01T00:00:00+00:00")
    commit(repo, {"calc.py": FIXED}, "fix: add", "2024-01-02T00:00:00+00:00")
    fix = sh(repo, "diff", base, "HEAD", "--", "calc.py")
    commit(repo, {"tests/test_calc.py": NEW_TESTS}, "test: add", "2024-01-03T00:00:00+00:00")
    test_patch = sh(repo, "diff", "HEAD~1", "HEAD", "--", "tests/test_calc.py")
    task = Task(id="calc-1", repo="o/calc", source="test", created_at="2024-01-03T00:00:00+00:00",
                base_commit=base, problem_statement="add() subtracts instead of adding",
                patch=fix, test_patch=test_patch, fail_to_pass=["tests/test_calc.py::test_add"],
                pass_to_pass=["tests/test_calc.py::test_mul"],
                fix_files=files_in_patch(fix), test_files=files_in_patch(test_patch))
    return repo, task


def fake_agent(tmp_path, body: str) -> str:
    p = tmp_path / "agent.py"
    p.write_text("import sys, pathlib\n" + body)
    return f"{sys.executable} {p}"


def test_workspace_has_no_future_history(calc, tmp_path):
    repo, task = calc
    ws = workspace.create(repo, task.base_commit, tmp_path / "ws")
    log = subprocess.run(["git", "-C", str(ws), "log", "--oneline"], capture_output=True, text=True).stdout
    assert len(log.strip().splitlines()) == 1, "workspace must contain only the starting snapshot"
    assert "a - b" in (ws / "calc.py").read_text()


def test_validate_real_task(calc, tmp_path):
    repo, task = calc
    out = runner.validate(task, repo, tmp_path / "wsr", repeats=2)
    assert out["valid"], out
    assert out["fails_before"] == [True, True] and out["passes_after"] == [True, True]


def test_attempt_fixing_agent_resolves(calc, tmp_path):
    repo, task = calc
    agent = fake_agent(tmp_path, "pathlib.Path('calc.py').write_text(pathlib.Path('calc.py').read_text().replace('a - b','a + b'))\n")
    res = runner.attempt(task, repo, tmp_path / "wsr", tmp_path / "run", arm="baseline", setup_dir=None,
                         seed=1, guard=Path("unused"), agent_cmd=agent)
    assert res.resolved and res.grade["f2p_passed"] == ["tests/test_calc.py::test_add"]


def test_attempt_cheating_agent_cannot_pass_by_editing_tests(calc, tmp_path):
    repo, task = calc
    # "Fixes" nothing, but deletes the existing test and writes a fake passing test
    agent = fake_agent(tmp_path, "pathlib.Path('tests/test_calc.py').write_text('def test_add():\\n    assert True\\n')\n")
    res = runner.attempt(task, repo, tmp_path / "wsr", tmp_path / "run2", arm="baseline", setup_dir=None,
                         seed=1, guard=Path("unused"), agent_cmd=agent)
    assert not res.resolved and res.grade["f2p_failed"] == ["tests/test_calc.py::test_add"]


def test_attempt_regression_is_caught(calc, tmp_path):
    repo, task = calc
    # Fixes add() but breaks mul(): a regression
    agent = fake_agent(tmp_path, "pathlib.Path('calc.py').write_text("
                       "'def add(a, b):\\n    return a + b\\n\\n\\ndef mul(a, b):\\n    return 0\\n')\n")
    res = runner.attempt(task, repo, tmp_path / "wsr", tmp_path / "run3", arm="baseline", setup_dir=None,
                         seed=1, guard=Path("unused"), agent_cmd=agent)
    assert not res.resolved and res.grade["p2p_failed"] == ["tests/test_calc.py::test_mul"]


def test_setup_is_installed_and_not_counted_as_agent_change(calc, tmp_path):
    repo, task = calc
    setup = tmp_path / "setup"
    (setup / ".muse").mkdir(parents=True)
    (setup / "AGENTS.md").write_text("Run the tests before finishing.\n")
    (setup / ".muse" / "hooks.json").write_text(json.dumps({"hooks": {}}))
    agent = fake_agent(tmp_path, "assert pathlib.Path('AGENTS.md').exists()\n"
                                 "pathlib.Path('calc.py').write_text(pathlib.Path('calc.py').read_text().replace('a - b','a + b'))\n")
    res = runner.attempt(task, repo, tmp_path / "wsr", tmp_path / "run4", arm="setup", setup_dir=setup,
                         seed=1, guard=Path("unused"), agent_cmd=agent)
    patch = (tmp_path / "run4" / "agent.patch").read_text()
    assert res.resolved and "AGENTS.md" not in patch and "calc.py" in patch


def test_relative_workdir_paths(calc, tmp_path, monkeypatch):
    """Regression: the CLI's default workdir is relative (.uplift/...)."""
    repo, task = calc
    monkeypatch.chdir(tmp_path)
    out = runner.validate(task, repo, Path(".uplift/workspaces"), repeats=1)
    assert out["valid"], out


def test_guard_path_with_relative_run_dir(calc, tmp_path, monkeypatch):
    """Regression (sqlglot-3855 paid run): a relative run_dir made the guard (run with
    cwd=workspace) write guard_summary.json into the workspace, so cost_usd was null and
    the guard logs ended up in agent.patch."""
    repo, task = calc
    guard = tmp_path / "fake_guard.py"
    guard.write_text(
        "import json, pathlib, sys\n"
        "args = sys.argv[1:]\n"
        "log_dir = pathlib.Path(args[args.index('--log-dir') + 1])\n"
        "log_dir.mkdir(parents=True, exist_ok=True)\n"
        "(log_dir / 'stdout.jsonl').write_text('{}\\n')\n"
        "(log_dir / 'guard_summary.json').write_text(json.dumps(\n"
        "    {'exit_code': 0, 'parsed_cost_usd': 0.0123, 'tokens': {'input': 100, 'cached': 40, 'output': 7}}))\n"
        "p = pathlib.Path('calc.py')\n"
        "p.write_text(p.read_text().replace('a - b', 'a + b'))\n")
    monkeypatch.chdir(tmp_path)
    run_dir = Path(".uplift/runs/baseline/calc-1-s1")
    res = runner.attempt(task, repo, Path(".uplift/workspaces"), run_dir, arm="baseline", setup_dir=None,
                         seed=1, guard=guard)
    assert res.resolved
    result = json.loads((tmp_path / run_dir / "result.json").read_text())
    assert result["cost_usd"] == 0.0123
    assert result["tokens"] == {"input": 100, "cached": 40, "output": 7}
    assert (tmp_path / run_dir / "guard_summary.json").exists()
    patch = (tmp_path / run_dir / "agent.patch").read_text()
    assert "calc.py" in patch
    assert "guard_summary.json" not in patch and "stdout.jsonl" not in patch


def test_stray_guard_logs_excluded_from_agent_diff(calc, tmp_path):
    repo, task = calc
    ws = workspace.create(repo, task.base_commit, tmp_path / "ws")
    for name in ("guard_summary.json", "stdout.jsonl", "stderr_trace.log"):
        (ws / "sub" / name).parent.mkdir(exist_ok=True)
        (ws / "sub" / name).write_text("{}")
    (ws / "calc.py").write_text(FIXED)
    patch = workspace.agent_diff(ws)
    assert "calc.py" in patch
    assert not any(n in patch for n in ("guard_summary.json", "stdout.jsonl", "stderr_trace.log"))


def test_parse_pytest_subtests():
    """Regression (sqlglot-3855): newer pytest prints PASSED for the parent even when a
    sub-test failed. The parent must count as FAILED."""
    out = ("PASSED tests/dialects/test_spark.py::TestSpark::test_hint\n"
           "PASSED tests/dialects/test_spark.py::TestSpark::test_spark\n"
           "SUBFAILED[SELECT DATE_FORMAT(DATE '2020-01-01', 'EEEE') AS weekday -> presto] "
           "tests/dialects/test_spark.py::TestSpark::test_spark\n"
           "SUBPASSED[ok case] tests/dialects/test_spark.py::TestSpark::test_hint\n")
    r = grade.parse_pytest(out)
    assert r["tests/dialects/test_spark.py::TestSpark::test_spark"] == "FAILED"
    assert r["tests/dialects/test_spark.py::TestSpark::test_hint"] == "PASSED"


def test_parse_pytest():
    out = "PASSED tests/a.py::test_x\nFAILED tests/a.py::test_y - assert 1 == 2\nERROR tests/b.py::T::t[1-2]\n"
    assert grade.parse_pytest(out) == {"tests/a.py::test_x": "PASSED", "tests/a.py::test_y": "FAILED",
                                      "tests/b.py::T::t[1-2]": "ERROR"}


def test_guard_timeout_is_an_error_never_a_pass(calc, tmp_path):
    """The guard exits 124 when it kills a run that ran out of time. Even if the code happens to
    be fixed by then, the run is an error and is not graded."""
    repo, task = calc
    agent = fake_agent(tmp_path, "pathlib.Path('calc.py').write_text(pathlib.Path('calc.py').read_text()"
                                 ".replace('a - b','a + b'))\nsys.exit(124)\n")
    res = runner.attempt(task, repo, tmp_path / "wsr", tmp_path / "run", arm="none", setup_dir=None,
                         seed=1, guard=Path("unused"), agent_cmd=agent)
    assert not res.resolved and res.grade == {} and "timed out" in res.error
    r = json.loads((tmp_path / "run" / "result.json").read_text())
    assert r["resolved"] is False and r["agent_exit"] == 124 and "timed out" in r["error"]


def test_nonzero_exit_with_a_patch_is_graded(calc, tmp_path):
    """Muse exits 1 when it uses up its step limit; the patch left behind is graded as usual."""
    clone, t = calc
    agent = fake_agent(tmp_path, "pathlib.Path('calc.py').write_text(pathlib.Path('calc.py').read_text()"
                                 ".replace('a - b','a + b'))\nsys.exit(1)\n")
    res = runner.attempt(t, clone, tmp_path / "ws", tmp_path / "run", arm="x", setup_dir=None, seed=1,
                  guard=Path("/nonexistent"), agent_cmd=agent)
    r = json.loads((tmp_path / "run" / "result.json").read_text())
    assert res.resolved and r["resolved"] is True and r["agent_exit"] == 1 and r["error"] == ""
    assert r["grade"]["f2p_failed"] == []


def test_nonzero_exit_with_a_wrong_patch_is_a_graded_failure(calc, tmp_path):
    clone, t = calc
    agent = fake_agent(tmp_path, "pathlib.Path('calc.py').write_text(pathlib.Path('calc.py').read_text()"
                                 " + '# nothing useful\\n')\nsys.exit(1)\n")
    runner.attempt(t, clone, tmp_path / "ws", tmp_path / "run", arm="x", setup_dir=None, seed=1,
                   guard=Path("/nonexistent"), agent_cmd=agent)
    r = json.loads((tmp_path / "run" / "result.json").read_text())
    assert r["resolved"] is False and r["error"] == "" and r["grade"]["f2p_failed"]


def test_nonzero_exit_with_no_patch_is_an_error(calc, tmp_path):
    clone, t = calc
    runner.attempt(t, clone, tmp_path / "ws", tmp_path / "run", arm="x", setup_dir=None, seed=1,
                   guard=Path("/nonexistent"), agent_cmd=fake_agent(tmp_path, "sys.exit(1)\n"))
    r = json.loads((tmp_path / "run" / "result.json").read_text())
    assert r["resolved"] is False and r["grade"] == {} and "no patch" in r["error"]


@pytest.mark.parametrize("rc, summary, guarded, why", [
    (124, {}, True, "timed out"),
    (1, {}, True, "guard failed"),                 # the guard itself crashed: no summary
    (247, {"exit_code": -9}, True, "killed"),      # Muse killed by a signal
    (127, {"exit_code": 127}, True, "never started"),
    (0, {"exit_code": 0}, True, ""),
    (1, {"exit_code": 1}, True, ""),
])
def test_infra_failures(rc, summary, guarded, why):
    got = runner.infra_failure(rc, False, 10, 5, "diff --git a b\n", summary, guarded=guarded)
    assert (why in got) and (bool(got) == bool(why))
    assert "hard-killed" in runner.infra_failure(0, True, 10, 5, "x", {}, guarded=True)


def test_agent_end_reads_muses_last_word(tmp_path):
    (tmp_path / "stderr_trace.log").write_text("x\nrun ended with Failed: model did not reach a terminal state\n")
    assert runner.agent_end(tmp_path).endswith("terminal state")
    assert runner.agent_end(tmp_path / "missing") == ""


def test_regrade_applies_the_saved_patch_to_a_fresh_workspace(calc, tmp_path):
    clone, t = calc
    agent = fake_agent(tmp_path, "pathlib.Path('calc.py').write_text(pathlib.Path('calc.py').read_text()"
                                 ".replace('a - b','a + b'))\nsys.exit(1)\n")
    run = tmp_path / "run"
    runner.attempt(t, clone, tmp_path / "ws", run, arm="x", setup_dir=None, seed=1, guard=Path("/nonexistent"),
                   agent_cmd=agent)
    old = json.loads((run / "result.json").read_text())
    (run / "result.json").write_text(json.dumps(dict(old, resolved=False, grade={}, error="agent exited 1")))
    r = runner.regrade(t, clone, tmp_path / "ws2", run)
    assert r["resolved"] is True and r["error"] == "" and r["regraded"] and r["agent_exit"] == 1
    assert json.loads((run / "result.before_regrade.json").read_text())["error"] == "agent exited 1"
    assert not (tmp_path / "ws2" / t.id / "regrade-x-s1").exists()


def test_hung_run_is_hard_killed_with_its_children(calc, tmp_path):
    repo, task = calc
    pidfile = tmp_path / "child.pid"
    agent = fake_agent(tmp_path, "import subprocess, time\n"
                                 f"c = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(600)'])\n"
                                 f"pathlib.Path({str(pidfile)!r}).write_text(str(c.pid))\n"
                                 "time.sleep(600)\n")
    t0 = __import__("time").time()
    res = runner.attempt(task, repo, tmp_path / "wsr", tmp_path / "run", arm="none", setup_dir=None, seed=1,
                         guard=Path("unused"), agent_cmd=agent, timeout=2, kill_grace=1)
    assert __import__("time").time() - t0 < 60
    assert not res.resolved and "hard-killed" in res.error
    import os
    child = int(pidfile.read_text())
    try:
        os.kill(child, 0)
        alive = True
    except ProcessLookupError:
        alive = False
    assert not alive, "the agent's child processes are killed too"
