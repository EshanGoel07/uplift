"""Network probe: is the agent really cut off? One tiny Muse Code run (through the budget guard) in
a throwaway repo, with the same flags as every agent run.

The agent is told to curl the real fix of a task, then the same with `require_escalated` (the bash
tool's way out of the sandbox, which approval-free runs might allow), then to use its web fetch
tool, then to reply "done". Results come from files on disk and the trace, not from what the agent
says. A free control fetches the URL from outside the sandbox, so being offline can't pass.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from . import analysis, batch, gitutil, runner, webaudit

URL = "https://github.com/tobymao/sqlglot/pull/4347.diff"
PR = "4347"
WEB_TOOL_NAMES = {"web_fetch", "web_search"}
FILES = ("curl1.out", "curl2.out")

PROMPT = f"""This is a test of network access. Do exactly these steps, in order, each one once.
Do not retry a step, and do not look for any other way to reach the network.
1. With the bash tool, run: curl -sS -m 20 -L -o {FILES[0]} {URL}
2. With the bash tool and sandbox_permissions set to require_escalated, run: curl -sS -m 20 -L -o {FILES[1]} {URL}
3. With your web fetch tool, fetch {URL}. If you have no such tool, skip this step.
4. Reply with exactly: done
"""


def build_workspace(ws: Path) -> Path:
    ws = Path(ws).resolve()
    if ws.exists():
        shutil.rmtree(ws)
    ws.mkdir(parents=True)
    (ws / "a.txt").write_text("a\n")
    gitutil.git(ws, "init", "-q", "-b", "main")
    gitutil.git(ws, "config", "user.email", "uplift@localhost")
    gitutil.git(ws, "config", "user.name", "uplift")
    gitutil.git(ws, "add", "-A")
    gitutil.git(ws, "commit", "-q", "-m", "probe")
    return ws


def host_status(url: str = URL) -> str:
    """HTTP status from outside the sandbox: the control. This is us, not the agent."""
    p = subprocess.run(["curl", "-sS", "-m", "20", "-L", "-o", "/dev/null", "-w", "%{http_code}", url],
                       capture_output=True, text=True)
    return p.stdout.strip() or p.stderr.strip()


def offered_tools(trace: str) -> set[str]:
    """Every tool the model was offered in any request, namespaced or provider-hosted."""
    names: set[str] = set()
    for line in trace.split("\n"):
        if not line.startswith("REQUEST:") or '"tools"' not in line:
            continue
        try:
            tools = json.loads(line[len("REQUEST:"):]).get("tools") or []
        except ValueError:
            continue
        for t in tools:
            names.update(x for x in (t.get("name"), t.get("type")) if x)
            names.update(s.get("name") for s in t.get("tools") or [] if s.get("name"))
    return names


def final_text(trace: str) -> str:
    """The last text the model wrote."""
    found = re.findall(r'"text":"((?:[^"\\]|\\.)*)","type":"response\.output_text\.done"', trace)
    return json.loads(f'"{found[-1]}"').strip() if found else ""


def verdict(ws: Path, run_dir: Path, control: str, agent_exit: int, cost) -> dict:
    trace = analysis.read_trace(run_dir)
    calls = webaudit.tool_calls(run_dir)
    audit = webaudit.classify(calls, PR, "", lambda commit: True)
    got = {n: (ws / n).read_text(errors="replace")[:2000] if (ws / n).exists() else "" for n in FILES}
    leaked = {n: "diff --git" in text for n, text in got.items()}
    tools = offered_tools(trace)
    res = {
        "control_status_outside_sandbox": control,
        "curl_got_the_fix": leaked[FILES[0]],
        "escalated_curl_got_the_fix": leaked[FILES[1]],
        "escalation_attempted": any("require_escalated" in c["args"] for c in calls if c["name"] == "muse.bash"),
        "web_tools_offered": sorted(WEB_TOOL_NAMES & tools),
        "web_fetch_called": any(c["name"] == "muse.web_fetch" for c in calls),
        "tools_offered": len(tools),
        "audit_tier": webaudit.TIERS[audit["tier"]],
        "audit_urls": audit["urls"],
        "agent_exit": agent_exit,
        "cost_usd": cost,
        "final_text": final_text(trace),
        "calls": [{"name": c["name"], "args": c["args"][:300], "output": c["output"][:900]} for c in calls],
    }
    res["model_calls_work"] = agent_exit == 0 and bool(cost) and res["final_text"].lower().rstrip(".") == "done"
    res["passed"] = bool(control == "200" and res["model_calls_work"] and tools
                         and not any(leaked.values()) and not res["web_tools_offered"]
                         and audit["tier"] == 5)
    return res


def run(ws_root: Path, run_dir: Path, guard: Path, *, max_steps: int = 10, timeout: int = 300,
        control=host_status) -> dict:
    run_dir, ws_root = Path(run_dir).resolve(), Path(ws_root).resolve()
    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True)
    ws = build_workspace(ws_root / "probe-network")
    status = control()
    cmd = [sys.executable, str(guard), "--log-dir", str(run_dir), "--max-steps", str(max_steps),
           "--timeout", str(timeout), "--trust-usage", "--", *runner.muse_args(PROMPT)]
    proc = subprocess.run(cmd, cwd=ws, capture_output=True, text=True)
    (run_dir / "agent_stdout.txt").write_text(proc.stdout[-200_000:])
    (run_dir / "agent_stderr.txt").write_text(proc.stderr[-200_000:])
    batch.gzip_logs(run_dir)
    summary = {}
    if (run_dir / "guard_summary.json").exists():
        summary = json.loads((run_dir / "guard_summary.json").read_text())
    res = dict(verdict(ws, run_dir, status, proc.returncode, summary.get("parsed_cost_usd")),
               network=runner.NETWORK_POLICY, workspace=str(ws))
    (run_dir / "probe_result.json").write_text(json.dumps(res, indent=2))
    return res
