"""The agent's network block: applied by the runner, recorded, and checked by the probe.
A fake guard stands in for the budget guard (no model calls)."""

import json
import socket
import sys
from pathlib import Path

import pytest

from uplift import batch, netprobe, runner, webaudit

from .test_runner import calc  # noqa: F401  (fixture)

BLOCK = ["--sandbox-network", "restricted", "--config", "tools.web_fetch.enabled=false",
         "--config", 'tools.web_search.mode="off"']
FIX = "p = pathlib.Path('calc.py')\np.write_text(p.read_text().replace('a - b', 'a + b'))\n"


def fake_guard(path: Path, body: str = "") -> Path:
    path.write_text(
        "import json, pathlib, sys\n"
        "args = sys.argv[1:]\n"
        "log = pathlib.Path(args[args.index('--log-dir') + 1])\n"
        "log.mkdir(parents=True, exist_ok=True)\n"
        "(log / 'argv.json').write_text(json.dumps(sys.argv))\n"
        "(log / 'guard_summary.json').write_text(json.dumps({'exit_code': 0, 'parsed_cost_usd': 0.01}))\n"
        + body)
    return path


def run_task(calc_fixture, tmp_path, body=FIX):
    repo, task = calc_fixture
    run = tmp_path / "run"
    res = runner.attempt(task, repo, tmp_path / "ws", run, arm="none", setup_dir=None, seed=1,
                         guard=fake_guard(tmp_path / "guard.py", body))
    return res, run


def muse_side(argv: list[str]) -> list[str]:
    return argv[argv.index("--") + 1:]


def test_runner_applies_the_block_to_muse_only(calc, tmp_path):  # noqa: F811
    res, run = run_task(calc, tmp_path)
    argv = json.loads((run / "argv.json").read_text())
    muse = muse_side(argv)
    assert res.resolved
    assert " ".join(BLOCK) in " ".join(muse)
    assert muse[-1].startswith("You are working in a Python repository")  # flags can't eat the prompt
    assert not any(bad in " ".join(muse[:-1]) for bad in ("--" + "yolo", "--disable-" + "sandbox"))


def test_block_values_cannot_silently_open_the_network():
    a = runner.muse_args("x")
    assert a[a.index("--sandbox-network") + 1] == "restricted"       # not Muse's default, proxy-only
    settings = dict(x.split("=", 1) for x in a if x.startswith("tools."))
    assert json.loads(settings["tools.web_fetch.enabled"]) is False  # Muse reads these values as JSON
    assert json.loads(settings["tools.web_search.mode"]) == "off"


def test_guard_can_still_reach_the_proxy(calc, tmp_path):  # noqa: F811
    """The guard reserves and settles on 127.0.0.1:8787 from outside the block, so it must not be
    wrapped and must keep its default proxy address."""
    server = socket.create_server(("127.0.0.1", 0))
    port = server.getsockname()[1]
    body = (f"import socket\nsocket.create_connection(('127.0.0.1', {port}), timeout=5).close()\n"
            "(log / 'reached').write_text('1')\n" + FIX)
    _, run = run_task(calc, tmp_path, body)
    server.close()
    assert (run / "reached").exists()
    argv = json.loads((run / "argv.json").read_text())
    assert argv[0].endswith("guard.py") and "--proxy" not in argv


def test_result_json_records_the_policy(calc, tmp_path):  # noqa: F811
    _, run = run_task(calc, tmp_path)
    assert json.loads((run / "result.json").read_text())["network"] == "blocked"


def test_failed_run_records_the_policy_too(calc, tmp_path):  # noqa: F811
    _, run = run_task(calc, tmp_path, "sys.exit(1)\n")
    r = json.loads((run / "result.json").read_text())
    assert r["network"] == "blocked" and r["error"]


def test_test_agents_do_not_claim_the_block(calc, tmp_path):  # noqa: F811
    repo, task = calc
    agent = tmp_path / "agent.py"
    agent.write_text("import pathlib\n" + FIX)
    runner.attempt(task, repo, tmp_path / "ws", tmp_path / "run", arm="none", setup_dir=None, seed=1,
                   guard=Path("unused"), agent_cmd=f"{sys.executable} {agent}")
    assert json.loads((tmp_path / "run" / "result.json").read_text())["network"] != "blocked"


def test_a_result_is_not_marked_blocked_by_default():
    assert runner.RunResult("t", "a", 1, False, {}).network == ""


# Probe verdict: the trace below is what Muse writes, reduced to the fields the probe reads.

def bash_call(cid, args, output):
    return [{"type": "function_call", "call_id": cid, "name": "muse.bash", "arguments": json.dumps(args)},
            {"type": "function_call_output", "call_id": cid, "output": output}]


SAFE_TOOLS = [{"type": "namespace", "name": "muse", "tools": [{"name": "bash"}, {"name": "read_file"}]}]
DENIED = '{"exit_code": 6, "output": "curl: (6) Could not resolve host: github.com"}'
TEXT_DONE = r'SSE RESPONSE: event: x\ndata: {"text":"done","type":"response.output_text.done"}'


REFUSED = "tool failed: launch policy forbids unsandboxed execution"   # exact text from the paid probe


def fake_run(tmp_path, tools=SAFE_TOOLS, output=DENIED, escalated=REFUSED, text=TEXT_DONE):
    run, ws = tmp_path / "run", tmp_path / "ws"
    run.mkdir()
    ws.mkdir()
    items = bash_call("c1", {"command": f"curl -o curl1.out {netprobe.URL}"}, output) + \
        bash_call("c2", {"command": f"curl -o curl2.out {netprobe.URL}", "sandbox_permissions": "require_escalated"}, escalated)
    (run / "stderr_trace.log").write_text("REQUEST:" + json.dumps({"tools": tools, "input": items}) + "\n" + text + "\n")
    batch.gzip_logs(run)
    return ws, run


def test_probe_passes_when_everything_is_blocked(tmp_path):
    ws, run = fake_run(tmp_path)
    r = netprobe.verdict(ws, run, "200", 0, 0.01)
    assert r["passed"] and r["escalation_attempted"] and r["audit_tier"] == "clean"
    assert "Could not resolve host" in r["calls"][0]["output"] and r["final_text"] == "done"


def test_probe_fails_if_a_curl_got_the_fix(tmp_path):
    ws, run = fake_run(tmp_path)
    (ws / "curl2.out").write_text("diff --git a/x b/x\n")
    r = netprobe.verdict(ws, run, "200", 0, 0.01)
    assert not r["passed"] and r["escalated_curl_got_the_fix"]


def test_probe_fails_if_web_tools_are_still_offered(tmp_path):
    tools = [{"type": "namespace", "name": "muse", "tools": [{"name": "bash"}, {"name": "web_fetch"}]}]
    ws, run = fake_run(tmp_path, tools=tools)
    r = netprobe.verdict(ws, run, "200", 0, 0.01)
    assert not r["passed"] and r["web_tools_offered"] == ["web_fetch"]


def test_probe_fails_if_a_hosted_search_tool_is_offered(tmp_path):
    ws, run = fake_run(tmp_path, tools=SAFE_TOOLS + [{"type": "web_search"}])
    assert not netprobe.verdict(ws, run, "200", 0, 0.01)["passed"]


def test_probe_fails_if_the_audit_sees_the_fix(tmp_path):
    ws, run = fake_run(tmp_path, output='{"exit_code": 0, "output": "saved"}')
    r = netprobe.verdict(ws, run, "200", 0, 0.01)
    assert not r["passed"] and r["audit_tier"] == "own_fix"


def test_probe_fails_if_the_audit_sees_an_escalated_fetch(tmp_path):
    ws, run = fake_run(tmp_path, escalated='{"exit_code": 0, "output": "saved"}')
    assert not netprobe.verdict(ws, run, "200", 0, 0.01)["passed"]


@pytest.mark.parametrize("output", [
    REFUSED,
    '{"exit_code": 0, "output": "curl: (6) Could not resolve host: x"}',  # `curl ... | head`
])
def test_audit_does_not_count_blocked_calls(output):
    calls = [{"name": "muse.bash", "args": f"curl {netprobe.URL} | head", "output": output}]
    assert webaudit.classify(calls, netprobe.PR, "", lambda c: True)["tier"] == 5


@pytest.mark.parametrize("output", [
    '{"exit_code": 0, "output": "diff --git a/x b/x"}',
    '{"exit_code": 0, "output": ""}',       # dev run 4014 fetched upstream code and printed nothing
])
def test_audit_still_counts_a_real_fetch(output):
    calls = [{"name": "muse.bash", "args": f"curl -o fix.diff {netprobe.URL}", "output": output}]
    assert webaudit.classify(calls, netprobe.PR, "", lambda c: True)["tier"] == 1


@pytest.mark.parametrize("control, exit_code, cost, text", [
    ("000", 0, 0.01, TEXT_DONE),                    # offline: a block proves nothing
    ("200", 1, 0.01, TEXT_DONE),                    # Muse failed
    ("200", 0, None, TEXT_DONE),                    # no model usage
    ("200", 0, 0.01, "no text"),                    # never replied
])
def test_probe_does_not_pass_without_control_and_model(tmp_path, control, exit_code, cost, text):
    ws, run = fake_run(tmp_path, text=text)
    assert not netprobe.verdict(ws, run, control, exit_code, cost)["passed"]


def test_probe_fails_with_an_empty_trace(tmp_path):
    (tmp_path / "ws").mkdir()
    (tmp_path / "run").mkdir()
    assert not netprobe.verdict(tmp_path / "ws", tmp_path / "run", "200", 0, 0.01)["passed"]


def test_probe_run_uses_the_same_flags_as_agent_runs(tmp_path):
    body = "(log / 'stderr_trace.log').write_text('')\n"
    r = netprobe.run(tmp_path / "ws", tmp_path / "run", fake_guard(tmp_path / "guard.py", body),
                     control=lambda: "200")
    muse = muse_side(json.loads((tmp_path / "run" / "argv.json").read_text()))
    assert muse[:-1] == runner.muse_args("x")[:-1] and muse[-1] == netprobe.PROMPT
    assert not r["passed"]
    assert json.loads((tmp_path / "run" / "probe_result.json").read_text())["network"] == "blocked"
    assert (Path(r["workspace"]) / ".git").is_dir() and webaudit.tool_calls(tmp_path / "run") == []
