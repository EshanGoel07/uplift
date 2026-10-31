"""Arms, generator inputs and sensor hooks, on synthetic repos (no model calls)."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from uplift import cli, generate as gen, probe, runner, workspace

from .test_core import commit, repo, sh  # noqa: F401 (repo is a fixture)
from .test_runner import calc, fake_agent  # noqa: F401 (calc is a fixture)

CUTOFF = "2024-10-30T21:34:46+02:00"
RISK = {"snapshot": "SNAP", "snapshot_date": CUTOFF, "top_risk_files": ["calc.py"], "files": [],
        "co_change_rules": [{"if_edited": "calc.py", "expect_also": "README.md", "support": 5, "confidence": 0.9}],
        "tests_for_source": {"calc.py": ["tests/test_calc.py"]}}
SPEC = {"agents_md": "Run `pytest tests/test_calc.py` after editing calc.py.",
        "lint": {"ruff_check_args": ["--ignore", "E741"], "format_line_length": None, "why": ""},
        "cochange": [{"if_edited": "calc.py", "expect_also": "README.md", "message": "Document behaviour changes."}],
        "verify": {"extra_tests_for_source": {}, "why": ""}}


def arms(tmp_path):
    out = tmp_path / "arms"
    gen.render_arms(SPEC, RISK, out, generator_run="test")
    return out


def test_render_arms_and_hooks_json_format(tmp_path):
    out = arms(tmp_path)
    assert sorted(p.name for p in out.iterdir()) == sorted(gen.ARMS)
    assert not (out / "none" / "AGENTS.md").exists() and not (out / "none" / ".muse").exists()
    assert (out / "prose" / "AGENTS.md").exists() and not (out / "prose" / ".muse").exists()
    assert not (out / "sensors" / "AGENTS.md").exists()
    for arm, events in (("sensors", {"PostToolUse", "Stop"}), ("both", {"PostToolUse", "Stop"}),
                        ("lint-only", {"PostToolUse"}), ("cochange-only", {"PostToolUse"}), ("verify-only", {"Stop"})):
        raw = json.loads((out / arm / ".muse" / "hooks.json").read_text())
        assert set(raw) == {"hooks"}, "event map must be nested under 'hooks' (bare map is ignored by Muse)"
        h = raw["hooks"]
        assert set(h) == events, arm                                   # object keyed by event
        for groups in h.values():
            assert isinstance(groups, list)
            for g in groups:
                assert isinstance(g["hooks"], list) and set(g) <= {"matcher", "hooks"}
                for handler in g["hooks"]:
                    assert handler["type"] == "command" and isinstance(handler["command"], str)
                    assert "{WORKSPACE}/.muse/uplift_hooks/uplift_hook.py" in handler["command"]
        cfg = json.loads((out / arm / ".muse" / "uplift_hooks" / "config.json").read_text())
        assert cfg["checks"] == gen.ARMS[arm][1]
        assert (out / arm / ".muse" / "uplift_hooks" / "uplift_hook.py").exists()
    m = json.loads((out / "both" / "MANIFEST.json").read_text())
    assert m["generator_run"] == "test" and set(m["sha256"]) == set(m["files"])


def test_install_arm_strips_repo_agent_files_and_fills_workspace(tmp_path):
    ws = tmp_path / "ws"
    ws.mkdir()
    sh(ws, "init", "-q", "-b", "main")
    sh(ws, "config", "user.email", "t@t")
    sh(ws, "config", "user.name", "t")
    for name in ("calc.py", "AGENTS.md", "CLAUDE.md"):
        (ws / name).write_text("repo's own\n")
    sh(ws, "add", "-f", ".")                    # -f: a global gitignore may list CLAUDE.md
    sh(ws, "commit", "-q", "-m", "init")
    got = workspace.install_arm(ws, arms(tmp_path) / "sensors")
    assert got["stripped"] == ["AGENTS.md", "CLAUDE.md"]
    assert not (ws / "AGENTS.md").exists() and not (ws / "CLAUDE.md").exists()
    assert "MANIFEST.json" not in got["copied"] and not (ws / "MANIFEST.json").exists()
    hooks = (ws / ".muse" / "hooks.json").read_text()
    assert "{WORKSPACE}" not in hooks and str(ws.resolve()) in hooks
    assert sh(ws, "status", "--porcelain").strip() == "", "arm install is committed"


def snapshot(tmp_path, ignored: bool) -> Path:
    """Workspace from a snapshot like sqlglot's: AGENTS.md, and CLAUDE.md as a symlink to it."""
    src = tmp_path / "src"
    src.mkdir()
    sh(src, "init", "-q", "-b", "main")
    sh(src, "config", "user.email", "t@t")
    sh(src, "config", "user.name", "t")
    (src / "calc.py").write_text("x = 1\n")
    (src / "AGENTS.md").write_text("repo's own\n")
    (src / "CLAUDE.md").symlink_to("AGENTS.md")
    if ignored:                                 # stands in for a global gitignore listing CLAUDE.md
        (src / ".gitignore").write_text("CLAUDE.md\n")
    sh(src, "add", "-f", ".")
    sh(src, "commit", "-q", "-m", "init")
    ws = workspace.create(src, sh(src, "rev-parse", "HEAD").strip(), tmp_path / "ws")
    if not ignored:
        sh(ws, "add", "-f", "CLAUDE.md")        # -f: a global gitignore may list CLAUDE.md
        sh(ws, "commit", "-q", "-m", "track")
    assert bool(sh(ws, "ls-files", "CLAUDE.md").strip()) is not ignored
    return ws


@pytest.mark.parametrize("ignored", [True, False], ids=["untracked", "tracked"])
@pytest.mark.parametrize("arm", ["none", "prose"])
def test_install_arm_strips_snapshot_agent_files_tracked_or_not(tmp_path, arm, ignored):
    ws = snapshot(tmp_path, ignored)
    got = workspace.install_arm(ws, arms(tmp_path) / arm)
    assert got["stripped"] == ["AGENTS.md", "CLAUDE.md"]
    assert not os.path.lexists(ws / "CLAUDE.md")
    if arm == "none":
        assert not os.path.lexists(ws / "AGENTS.md") and got["copied"] == []
        assert sh(ws, "ls-files", "AGENTS.md", "CLAUDE.md").strip() == ""
    else:
        assert (ws / "AGENTS.md").read_text() == SPEC["agents_md"] + "\n"
        assert sh(ws, "show", "HEAD:AGENTS.md") == SPEC["agents_md"] + "\n"
    assert sh(ws, "status", "--porcelain").strip() == "", "the removal is not left for the agent's patch"
    assert workspace.agent_diff(ws) == ""


def test_install_arm_strips_dangling_symlink(tmp_path):
    ws = snapshot(tmp_path, ignored=True)
    (ws / "AGENTS.md").unlink()
    assert workspace.install_arm(ws, None)["stripped"] == ["CLAUDE.md"]
    assert not os.path.lexists(ws / "CLAUDE.md")


def test_arm_files_excluded_from_patch_and_recorded(calc, tmp_path):  # noqa: F811
    repo, task = calc
    body = ("pathlib.Path('AGENTS.md').write_text('agent rewrote this')\n"
            "pathlib.Path('.muse/uplift_hooks/state.json').write_text('{}')\n"
            "pathlib.Path('.muse/hooks.json').write_text('{}')\n"
            "pathlib.Path('.muse/uplift_hooks/fired.jsonl').write_text("
            "'{\"check\": \"lint\", \"fired\": true}\\n{\"check\": \"lint\", \"fired\": false}\\n')\n"
            "pathlib.Path('calc.py').write_text(pathlib.Path('calc.py').read_text().replace('a - b','a + b'))\n")
    res = runner.attempt(task, repo, tmp_path / "wsr", tmp_path / "run", arm="both", setup_dir=arms(tmp_path) / "both",
                         seed=1, guard=Path("unused"), agent_cmd=fake_agent(tmp_path, body))
    patch = (tmp_path / "run" / "agent.patch").read_text()
    assert res.resolved
    assert "calc.py" in patch and "AGENTS.md" not in patch and ".muse" not in patch
    r = json.loads((tmp_path / "run" / "result.json").read_text())
    assert r["arm"] == "both" and "AGENTS.md" in r["arm_files"] and ".muse/hooks.json" in r["arm_files"]
    assert (tmp_path / "run" / "arm_manifest.json").exists()
    assert r["hooks"] == {"lint": {"runs": 2, "fired": 1}}, "hook log is collected from the workspace"


def test_run_one_arm_resolution(tmp_path, monkeypatch):
    monkeypatch.setattr(cli, "BUILTIN_ARMS", tmp_path / "builtin")
    (tmp_path / "builtin" / "handwritten").mkdir(parents=True)
    (tmp_path / "wd" / "o__r" / "arms" / "prose").mkdir(parents=True)
    assert cli.arm_dir(tmp_path / "wd", "o/r", "none") is None
    assert cli.arm_dir(tmp_path / "wd", "o/r", "prose") == tmp_path / "wd" / "o__r" / "arms" / "prose"
    assert cli.arm_dir(tmp_path / "wd", "o/r", "handwritten") == tmp_path / "builtin" / "handwritten"
    with pytest.raises(SystemExit):
        cli.arm_dir(tmp_path / "wd", "o/r", "nope")


def test_handwritten_arm_is_generic():
    text = (cli.BUILTIN_ARMS / "handwritten" / "AGENTS.md").read_text()
    assert len(text.splitlines()) > 30
    assert "sqlglot" not in text.lower() and "dialect" not in text.lower()


# --- generator inputs: date filtering --------------------------------------------------------

def fake_gh(args):
    if args[2] == "search/issues":
        return {"items": [
            {"number": 1, "title": "old pr", "created_at": "2024-09-01T00:00:00Z",
             "pull_request": {"merged_at": "2024-09-02T00:00:00Z"}},
            {"number": 2, "title": "merged after cutoff", "created_at": "2024-10-20T00:00:00Z",
             "pull_request": {"merged_at": "2024-11-02T00:00:00Z"}},
        ]}
    n = int(args[0].split("/")[-2])
    assert n == 1, "comments are never fetched for a PR merged after the cutoff"
    return [{"body": "keep generator changes minimal", "path": "calc.py", "created_at": "2024-09-01T10:00:00Z",
             "user": {"login": "maint", "type": "User"}},
            {"body": "late comment", "path": "calc.py", "created_at": "2024-11-05T00:00:00Z",
             "user": {"login": "maint", "type": "User"}},
            {"body": "bot noise", "path": "calc.py", "created_at": "2024-09-01T11:00:00Z",
             "user": {"login": "ci", "type": "Bot"}}]


def test_review_comments_are_date_filtered():
    got, stats = gen.review_comments("o/r", CUTOFF, gh=fake_gh)
    assert [c["body"] for c in got] == ["keep generator changes minimal"]
    assert stats["prs_dropped_by_date"] == 1 and stats["comments_dropped_by_date"] == 1


def test_filter_before_and_assert_before():
    kept, dropped = gen.filter_before([{"d": "2024-10-30T19:00:00Z"}, {"d": "2024-10-30T19:34:46Z"}, {"d": None}],
                                      CUTOFF, "d")
    assert kept == [{"d": "2024-10-30T19:00:00Z"}, {"d": "2024-10-30T19:34:46Z"}] and dropped == 1  # at cutoff: ok
    gen.assert_before({"history": [{"date": "2024-10-01T00:00:00Z"}]}, CUTOFF)
    with pytest.raises(gen.LeakageError):
        gen.assert_before({"review_comments": [{"created_at": "2024-11-01T00:00:00Z"}]}, CUTOFF)


def test_collect_inputs_only_sees_the_snapshot(repo, tmp_path):  # noqa: F811
    snap = commit(repo, {"sqlr/a.py": "x = 1\n", "tests/test_a.py": "", "README.md": "old readme\n"},
                  "init", "2024-10-01T00:00:00+00:00")
    commit(repo, {"sqlr/b.py": "later\n", "README.md": "FUTURE readme\n"}, "fix: after the snapshot",
           "2024-11-15T00:00:00+00:00")
    risk = dict(RISK, snapshot=snap, snapshot_date="2024-10-01T00:00:00+00:00")
    inputs = gen.collect_inputs("o/sqlr", repo, snap, risk, gh=fake_gh)
    assert inputs["docs"]["README.md"] == "old readme\n"
    assert inputs["tree"]["library"] == ["sqlr/a.py"]
    assert [h["subject"] for h in inputs["history"]] == ["init"]
    assert "FUTURE" not in json.dumps(inputs) and "after the snapshot" not in json.dumps(inputs)
    with pytest.raises(gen.LeakageError):
        gen.collect_inputs("o/sqlr", repo, snap, dict(RISK, snapshot="other"), gh=fake_gh)


def test_parse_spec_validates():
    inputs = {"risk": RISK, "tree": {"tests": ["tests/test_calc.py"]}}
    good = dict(SPEC, cochange=SPEC["cochange"] + [{"if_edited": "x.py", "expect_also": "y.py", "message": "invented"}],
                lint={"ruff_check_args": ["--ignore", "E741", "; rm -rf /"], "format_line_length": 100},
                verify={"extra_tests_for_source": {"calc.py": ["tests/test_calc.py", "tests/nope.py"]}})
    spec, problems = gen.parse_spec("Here you go:\n" + json.dumps(good), inputs)
    assert problems == []
    assert [c["if_edited"] for c in spec["cochange"]] == ["calc.py"]          # invented rule dropped
    assert spec["lint"]["ruff_check_args"] == ["--ignore", "E741"]          # shell junk dropped
    assert spec["verify"]["extra_tests_for_source"] == {"calc.py": ["tests/test_calc.py"]}
    _, problems = gen.parse_spec(json.dumps(dict(SPEC, agents_md="line\n" * 31)), inputs)
    assert "max 30" in problems[0]


def test_paths_check_reports_missing(repo):  # noqa: F811
    snap = commit(repo, {"sqlr/a.py": "1\n", "tests/test_a.py": ""}, "init", "2024-10-01T00:00:00+00:00")
    sh(repo, "mv", "sqlr/a.py", "sqlr/moved.py")
    sh(repo, "commit", "-q", "-m", "move")
    later = sh(repo, "rev-parse", "HEAD").strip()
    spec = dict(SPEC, agents_md="Fragile: `sqlr/a.py`; tests in tests/test_a.py.", cochange=[])
    named = gen.paths_named(spec)
    assert named["generated"] == ["sqlr/a.py", "tests/test_a.py"]
    assert gen.check_paths(repo, snap, named["generated"]) == []
    assert gen.check_paths(repo, later, named["generated"]) == ["sqlr/a.py"]


# --- the sensor hook script itself -------------------------------------------------------------

@pytest.fixture
def hooked(tmp_path):
    """A git workspace with the `both` arm installed and a .venv/bin/python that has pytest."""
    ws = tmp_path / "ws"
    ws.mkdir()
    sh(ws, "init", "-q", "-b", "main")
    sh(ws, "config", "user.email", "t@t")
    sh(ws, "config", "user.name", "t")
    commit(ws, {"calc.py": "def add(a, b):\n    return a + b\n", "README.md": "r\n",
                "tests/test_calc.py": "from calc import add\n\ndef test_add():\n    assert add(1, 2) == 3\n"},
           "init", "2024-01-01T00:00:00+00:00")
    (ws / ".git" / "info" / "exclude").write_text(".venv/\n__pycache__/\n")
    workspace.install_arm(ws, arms(tmp_path) / "both")
    (ws / ".venv" / "bin").mkdir(parents=True)
    (ws / ".venv" / "bin" / "python").symlink_to(sys.executable)
    return ws


def hook(ws, event, log):
    r = subprocess.run([sys.executable, str(ws / ".muse" / "uplift_hooks" / "uplift_hook.py"), event],
                       input="{}", capture_output=True, text=True, cwd=ws,
                       env=dict(os.environ, UPLIFT_HOOK_LOG=str(log)))
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout) if r.stdout.strip() else None


def test_hook_cochange_warns_once(hooked, tmp_path):
    log = tmp_path / "hooks.jsonl"
    assert hook(hooked, "PostToolUse", log) is None                     # nothing edited yet
    (hooked / "calc.py").write_text("def add(a, b):\n    return b + a\n")
    out = hook(hooked, "PostToolUse", log)["hookSpecificOutput"]   # default: additionalContext
    assert out["hookEventName"] == "PostToolUse" and "edited calc.py but not README.md" in out["additionalContext"]
    assert hook(hooked, "PostToolUse", log) is None                     # warned once only
    recs = [json.loads(line) for line in log.read_text().splitlines()]
    assert any(r["check"] == "cochange" and r["fired"] for r in recs)


def test_hook_verify_blocks_stop_on_failing_related_tests(hooked, tmp_path):
    log = tmp_path / "hooks.jsonl"
    assert hook(hooked, "Stop", log) is None                            # no change: nothing to verify
    (hooked / "calc.py").write_text("def add(a, b):\n    return a - b\n")
    out = hook(hooked, "Stop", log)
    assert out["decision"] == "block" and "tests/test_calc.py" in out["reason"] and "verify" in out["reason"]
    assert hook(hooked, "Stop", log)["decision"] == "block"
    assert hook(hooked, "Stop", log) is None, "at most max_stop_blocks blocks, then let the agent stop"
    (hooked / "calc.py").write_text("def add(a, b):\n    return a + b\n")
    recs = [json.loads(line) for line in log.read_text().splitlines()]
    assert sum(r["check"] == "verify" and r["fired"] for r in recs) == 2


def test_hook_wording_replaces_the_default_sentence(hooked, tmp_path):
    ws = hooked
    cfg_path = ws / ".muse" / "uplift_hooks" / "config.json"
    cfg = json.loads(cfg_path.read_text())
    cfg["wording"] = {"verify": "Run only the failing test."}
    cfg_path.write_text(json.dumps(cfg))
    (ws / "calc.py").write_text("def add(a, b):\n    return a - b\n")
    out = hook(ws, "Stop", tmp_path / "log.jsonl")
    assert "Run only the failing test." in out["reason"] and "Fix them before finishing" not in out["reason"]


def test_hook_block_reason_mode(hooked, tmp_path):
    cfg_path = hooked / ".muse" / "uplift_hooks" / "config.json"
    cfg = json.loads(cfg_path.read_text())
    cfg_path.write_text(json.dumps(dict(cfg, feedback="block_reason")))
    (hooked / "calc.py").write_text("def add(a, b):\n    return b + a\n")
    out = hook(hooked, "PostToolUse", tmp_path / "h.jsonl")
    assert out["decision"] == "block" and "co-change" in out["reason"]


def test_probe_workspace_and_analysis(tmp_path):
    ws = probe.build_workspace(tmp_path / "p", wrapped=True)
    cfg = json.loads((ws / ".muse" / "hooks.json").read_text())
    assert set(cfg["hooks"]) == set(probe.EVENTS)
    assert set(probe.hooks_config(ws, wrapped=False)) == set(probe.EVENTS)
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    events = [{"event": "PreToolUse", "env_log_set": True, "payload": {"tool_name": "shell", "input": "echo FORBIDDEN"}},
              {"event": "PostToolUse", "env_log_set": True, "payload": {"tool_name": "write_file", "path": "b.txt"}}]
    (run_dir / "hook_events.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n")
    (run_dir / "agent_stdout.txt").write_text("secret words: PINEAPPLE")
    res = probe.analyse(ws, run_dir)
    assert res["a_block_pretooluse"] and res["b_feedback_decision_block"] and not res["b_feedback_additional_context"]
    assert res["tool_names_seen"] == ["shell", "write_file"] and res["env_reaches_hooks"]
