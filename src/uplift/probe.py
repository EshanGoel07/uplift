"""Hook capability probe: can Muse Code hooks (a) block an action and (b) feed text back into
the agent's context? One tiny Muse Code run (through the budget guard) in a throwaway repo.

One hook script is registered on SessionStart, PreToolUse, PostToolUse and Stop. It logs every
payload (which also shows Muse's tool names and payload schema) and:

* PreToolUse: denies any tool call whose input contains FORBIDDEN       -> (a) blocking
* PostToolUse on b.txt: `decision: block` + reason (secret word PINEAPPLE) -> (b) feedback
* PostToolUse on d.txt: `additionalContext` (secret word MANGO)         -> (b) feedback, other form
* Stop, first time: `decision: block` + reason "create kiwi.txt"         -> can a Stop hook make
  the agent keep working (verify-before-finishing)?

The agent is asked to do the steps and report any secret words it was told.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from . import gitutil

EVENTS = ["SessionStart", "PreToolUse", "PostToolUse", "Stop"]

HOOK = r'''import json, os, sys
from pathlib import Path
event = sys.argv[1]
raw = sys.stdin.read()
try:
    payload = json.loads(raw) if raw.strip() else {}
except ValueError:
    payload = {"_unparsed": raw[:2000]}
ws = Path(__file__).resolve().parents[1]
rec = {"event": event, "env_log_set": bool(os.environ.get("UPLIFT_HOOK_LOG")), "cwd": os.getcwd(), "payload": payload}
for log in filter(None, [os.environ.get("UPLIFT_HOOK_LOG"), str(ws / ".muse" / "probe_events.jsonl")]):
    try:
        with open(log, "a") as f:
            f.write(json.dumps(rec) + "\n")
    except OSError:
        pass
text = json.dumps(payload)
out = None
if event == "PreToolUse" and "FORBIDDEN" in text:
    out = {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                  "permissionDecisionReason": "UPLIFT-PROBE: commands containing FORBIDDEN are not allowed"}}
elif event == "PostToolUse" and "b.txt" in text:
    out = {"decision": "block", "reason": "UPLIFT-PROBE: the secret word is PINEAPPLE"}
elif event == "PostToolUse" and "d.txt" in text:
    out = {"hookSpecificOutput": {"hookEventName": "PostToolUse",
                                  "additionalContext": "UPLIFT-PROBE: the second secret word is MANGO"}}
elif event == "Stop":
    marker = ws / ".muse" / "stop_blocked_once"
    if not marker.exists():
        marker.write_text("1")
        out = {"decision": "block", "reason": "UPLIFT-PROBE: before finishing, create kiwi.txt containing KIWI"}
if out is not None:
    print(json.dumps(out))
'''

PROMPT = """This is a test of tool hooks. Do these steps in order, using your tools:
1. Run the shell command: echo FORBIDDEN > blocked.txt
2. Create a file b.txt containing the word hello.
3. Create a file d.txt containing the word world.
4. Stop.
In your final message, list every secret word that a tool result or hook told you, and say whether step 1 was refused.
"""


def hooks_config(ws: Path, wrapped: bool) -> dict:
    """Event-keyed hook config (Claude-Code-like matcher groups). `wrapped` nests it under "hooks"."""
    script = ws / ".muse" / "probe_hook.py"
    cfg = {ev: [{"hooks": [{"type": "command", "command": f"python3 {script} {ev}", "timeout": 30}]}]
           for ev in EVENTS}
    return {"hooks": cfg} if wrapped else cfg


def build_workspace(ws: Path, wrapped: bool) -> Path:
    ws = Path(ws).resolve()
    if ws.exists():
        shutil.rmtree(ws)
    (ws / ".muse").mkdir(parents=True)
    (ws / "a.txt").write_text("a\n")
    (ws / ".muse" / "probe_hook.py").write_text(HOOK)
    (ws / ".muse" / "hooks.json").write_text(json.dumps(hooks_config(ws, wrapped), indent=2))
    gitutil.git(ws, "init", "-q", "-b", "main")
    gitutil.git(ws, "config", "user.email", "uplift@localhost")
    gitutil.git(ws, "config", "user.name", "uplift")
    gitutil.git(ws, "add", "-A")
    gitutil.git(ws, "commit", "-q", "-m", "probe")
    return ws


def analyse(ws: Path, run_dir: Path) -> dict:
    """What worked, from files on disk, the hook log and the agent's output."""
    events = []
    log = run_dir / "hook_events.jsonl"
    src = log if log.exists() else ws / ".muse" / "probe_events.jsonl"
    if src.exists():
        events = [json.loads(line) for line in src.read_text().splitlines() if line.strip()]
    out = ""
    for name in ("stdout.jsonl", "agent_stdout.txt"):
        if (run_dir / name).exists():
            out += (run_dir / name).read_text(errors="replace")
    final = out[-20000:]
    fired = sorted({e["event"] for e in events})
    return {
        "hooks_loaded": bool(events),
        "events_fired": fired,
        "env_reaches_hooks": any(e.get("env_log_set") for e in events),
        "a_block_pretooluse": (ws / "a.txt").exists() and not (ws / "blocked.txt").exists()
                              and any(e["event"] == "PreToolUse" and "FORBIDDEN" in json.dumps(e["payload"])
                                      for e in events),
        "blocked_txt_exists": (ws / "blocked.txt").exists(),
        "b_feedback_decision_block": "PINEAPPLE" in final,
        "b_feedback_additional_context": "MANGO" in final,
        "stop_block_makes_agent_continue": (ws / "kiwi.txt").exists(),
        "tool_names_seen": sorted({str(e["payload"].get("tool_name") or e["payload"].get("toolName") or "")
                                   for e in events if e["event"] in ("PreToolUse", "PostToolUse")} - {""}),
        "payload_keys": sorted({k for e in events for k in e.get("payload", {})}),
        "n_events": len(events),
    }


def run(ws_root: Path, run_dir: Path, guard: Path, *, wrapped: bool = False, max_steps: int = 15,
        timeout: int = 600, agent_cmd: str | None = None) -> dict:
    run_dir, ws_root = Path(run_dir).resolve(), Path(ws_root).resolve()
    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True)
    ws = build_workspace(ws_root / ("probe-hooks-wrapped" if wrapped else "probe-hooks"), wrapped)
    env = dict(os.environ, UPLIFT_HOOK_LOG=str(run_dir / "hook_events.jsonl"))
    if agent_cmd:  # tests only
        cmd = agent_cmd.split() + [PROMPT]
    else:
        cmd = [sys.executable, str(guard), "--log-dir", str(run_dir), "--max-steps", str(max_steps),
               "--timeout", str(timeout), "--trust-usage", "--", "--trust-workspace", "--disable-approval", PROMPT]
    proc = subprocess.run(cmd, cwd=ws, capture_output=True, text=True, env=env)
    (run_dir / "agent_stdout.txt").write_text(proc.stdout[-200_000:])
    (run_dir / "agent_stderr.txt").write_text(proc.stderr[-200_000:])
    res = analyse(ws, run_dir)
    summary = {}
    if (run_dir / "guard_summary.json").exists():
        summary = json.loads((run_dir / "guard_summary.json").read_text())
    res.update({"variant": "wrapped" if wrapped else "top-level", "agent_exit": proc.returncode,
                "cost_usd": summary.get("parsed_cost_usd"), "workspace": str(ws)})
    (run_dir / "probe_result.json").write_text(json.dumps(res, indent=2))
    return res
