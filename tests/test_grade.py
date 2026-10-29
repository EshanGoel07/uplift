"""pytest output parsing: multi-line sub-test entries and the fail-closed summary cross-check."""

from pathlib import Path

from uplift import grade

DATA = Path(__file__).parent / "data"
FLATTEN = "tests/dialects/test_snowflake.py::TestSnowflake::test_flatten"


def test_multiline_subfailed_real_sqlglot_4505():
    """Regression (sqlglot-4505): the sub-test label is multi-line SQL, so the node id is ~20
    lines below `SUBFAILED[`. pytest says `1 failed`; the parent's `PASSED` line must not win."""
    out = (DATA / "pytest_sqlglot_4505_before.txt").read_text()
    r = grade.parse_pytest(out)
    assert r[FLATTEN] == "FAILED"
    assert sum(s == "PASSED" for s in r.values()) == 37
    assert not any("::DATE" in k for k in r), "label text (uc.start_ts::DATE) is not a test id"
    assert grade.summary_counts(out) == {"failed": 1, "passed": 38}
    assert grade.check_output(out) == ""


def test_kwargs_subfailed_real_sqlglot_fresh_981e4924():
    """Regression: a sub-test labelled by keyword arguments prints `SUBFAILED(sql='...') <id>`
    (parentheses, not brackets). pytest says `21 failed`: 20 sub-tests + the parent."""
    out = (DATA / "pytest_sqlglot_fresh_981e4924_before.txt").read_text()
    assert grade.parse_pytest(out)["tests/dialects/test_clickhouse.py::TestClickhouse::test_global_join"] == "FAILED"
    assert grade.check_output(out) == ""
    both = ("PASSED tests/a.py::T::t\nSUBFAILED[msg (with parens)] (i=1) tests/a.py::T::t - x\n"
            "=== 1 failed, 1 passed in 0.1s ===\n")
    assert grade.parse_pytest(both) == {"tests/a.py::T::t": "FAILED"} and grade.check_output(both) == ""


SUMMARY_OK ="PASSED tests/a.py::test_x\nFAILED tests/a.py::test_y - boom\n=== 1 failed, 1 passed in 0.10s ===\n"


def test_check_output_agrees():
    assert grade.check_output(SUMMARY_OK) == ""
    sub = ("PASSED tests/a.py::T::t\nSUBFAILED[a\nb] tests/a.py::T::t - x\nSUBFAILED[c] tests/a.py::T::t - y\n"
           "SUBPASSED[d\nFAILED looks like a result] tests/a.py::T::t\n=== 2 failed, 1 passed in 0.1s ===\n")
    assert grade.parse_pytest(sub) == {"tests/a.py::T::t": "FAILED"}
    assert grade.check_output(sub) == ""
    split = "PASSED tests/a.py::T::t\nSUBFAILED[x] tests/a.py::T::t\n=== 1 passed, 1 subtests failed in 0.1s ===\n"
    assert grade.check_output(split) == ""


def test_check_output_mismatch_is_an_error():
    # pytest counted a failure the parser didn't see: must not grade.
    hidden = "PASSED tests/a.py::test_x\n=== 1 failed, 1 passed in 0.10s ===\n"
    assert "disagrees" in grade.check_output(hidden)
    # A sub-test entry whose id never appears.
    orphan = "PASSED tests/a.py::test_x\nSUBFAILED[label without id\n=== 1 failed, 1 passed in 0.1s ===\n"
    assert "without a test id" in grade.check_output(orphan)
    # Errors must be accounted for too.
    err = "PASSED tests/a.py::test_x\n=== 1 passed, 1 error in 0.1s ===\n"
    assert "disagrees" in grade.check_output(err)


def test_missing_summary_is_an_error():
    assert "no pytest summary" in grade.check_output("PASSED tests/a.py::test_x\n")      # crash
    assert "no pytest summary" in grade.check_output(SUMMARY_OK.splitlines()[0] + "\nUPLIFT: pytest timed out\n")


def test_workspace_pytest_ignores_parent_config_and_conftest(tmp_path):
    """Workspaces live under the uplift repo; its pyproject.toml / a conftest.py above the
    workspace must not affect the target repo's test run."""
    import sys
    (tmp_path / "pyproject.toml").write_text('[tool.pytest.ini_options]\naddopts = "--no-such-flag"\n')
    (tmp_path / "conftest.py").write_text("raise RuntimeError('parent conftest loaded')\n")
    ws = tmp_path / "ws"
    (ws / "tests").mkdir(parents=True)
    (ws / "tests" / "test_a.py").write_text("def test_a():\n    assert True\n")
    results, text = grade.run_tests(ws, Path(sys.executable), ["tests/test_a.py::test_a"])
    assert results == {"tests/test_a.py::test_a": "PASSED"}, text
    assert grade.check_output(text) == ""
    assert grade.pytest_config(ws) == __import__("os").devnull
    # The workspace's own config is used when it has one.
    (ws / "setup.cfg").write_text("[tool:pytest]\nmarkers = slow\n")
    assert grade.pytest_config(ws) == str(ws / "setup.cfg")


def test_grade_fails_closed(monkeypatch, tmp_path):
    """A run whose output fails the cross-check is never resolved, even if every F2P/P2P id
    parses as PASSED."""
    out = "PASSED tests/a.py::test_f2p\nPASSED tests/a.py::test_p2p\n=== 1 failed, 2 passed in 0.1s ===\n"
    monkeypatch.setattr(grade, "run_tests", lambda *a, **k: (grade.parse_pytest(out), out))
    monkeypatch.setattr(grade, "reset_test_files", lambda *a, **k: None)
    monkeypatch.setattr(grade.gitutil, "git_ok", lambda *a, **k: True)
    g = grade.grade(tmp_path, Path("py"), "base", "patch", [], ["tests/a.py::test_f2p"], ["tests/a.py::test_p2p"])
    assert not g.resolved and g.error.startswith("pytest output check failed")
    assert g.f2p_passed == []
