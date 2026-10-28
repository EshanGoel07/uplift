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


def test_parse_pytest():
    out = "PASSED tests/a.py::test_x\nFAILED tests/a.py::test_y - assert 1 == 2\nERROR tests/b.py::T::t[1-2]\n"
    assert grade.parse_pytest(out) == {"tests/a.py::test_x": "PASSED", "tests/a.py::test_y": "FAILED",
                                      "tests/b.py::T::t[1-2]": "ERROR"}
