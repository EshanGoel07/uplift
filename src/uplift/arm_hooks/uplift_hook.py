"""Uplift sensor hooks for Muse Code (stdlib only; installed as .muse/uplift_hooks/uplift_hook.py).

    python3 uplift_hook.py PostToolUse   # lint + co-change checks on files edited since last call
    python3 uplift_hook.py Stop          # verify: run tests related to the changed files

Which checks run, the lint flags, co-change rules and the source -> test mapping come from
config.json next to this file. Edited files are found with `git status` + mtimes, so the hook
does not depend on the tool payload's schema. Findings go back to the agent as hook feedback
(PostToolUse: `additionalContext` or `decision: block` + reason, per config; Stop: always
`decision: block` + reason, which makes Muse give the agent another turn with the reason). Every
evaluation is logged to fired.jsonl next to this file (Muse does not pass the environment to
hooks, so $UPLIFT_HOOK_LOG is only honoured when it does); the runner collects it afterwards.
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
WS = HERE.parents[1]
IGNORED = (".muse/", "AGENTS.md", ".venv/", ".uplift-run/")


def log(event, check, fired, detail=""):
    rec = {"t": round(time.time(), 3), "event": event, "check": check, "fired": fired, "detail": detail[:2000]}
    target = os.environ.get("UPLIFT_HOOK_LOG") or str(HERE / "fired.jsonl")
    try:
        with open(target, "a") as f:
            f.write(json.dumps(rec) + "\n")
    except OSError:
        pass


def load(name, default):
    try:
        return json.loads((HERE / name).read_text())
    except (OSError, ValueError):
        return default


def changed_files():
    out = subprocess.run(["git", "-C", str(WS), "status", "--porcelain", "--untracked-files=all"],
                         capture_output=True, text=True).stdout
    files = []
    for line in out.splitlines():
        path = line[3:].split(" -> ")[-1].strip().strip('"')
        if path and not path.startswith(IGNORED) and (WS / path).is_file():
            files.append(path)
    return sorted(files)


def tool(name):
    p = WS / ".venv" / "bin" / name
    return str(p) if p.exists() else None


def lint(files, cfg):
    ruff = tool("ruff")
    if not ruff:
        return []
    msgs = []
    for f in [f for f in files if f.endswith(".py")]:
        r = subprocess.run([ruff, "check", "--no-fix", "--quiet", *cfg["lint"]["ruff_check_args"], f],
                           cwd=WS, capture_output=True, text=True, timeout=60)
        if r.returncode != 0 and r.stdout.strip():
            msgs.append(f"ruff check {f}:\n" + "\n".join(r.stdout.strip().splitlines()[:15]))
        ll = cfg["lint"].get("format_line_length")
        if ll:
            r = subprocess.run([ruff, "format", "--check", "--quiet", "--line-length", str(ll), f],
                               cwd=WS, capture_output=True, text=True, timeout=60)
            if r.returncode != 0:
                msgs.append(f"ruff format: {f} is not formatted (line length {ll}); "
                            f"run `ruff format --line-length {ll} {f}`")
    note = cfg.get("wording", {}).get("lint")
    return msgs + [note] if msgs and note else msgs


def cochange(changed, cfg, state):
    msgs = []
    for rule in cfg["cochange"]:
        key = rule["if_edited"] + "->" + rule["expect_also"]
        if rule["if_edited"] in changed and rule["expect_also"] not in changed and key not in state["warned"]:
            state["warned"].append(key)
            msgs.append(f"co-change: you edited {rule['if_edited']} but not {rule['expect_also']}. {rule['message']}")
    return msgs


def related_tests(changed, cfg):
    tests = set()
    for f in changed:
        if f.startswith("tests/") and Path(f).name.startswith("test_"):
            tests.add(f)
        tests |= set(cfg["tests_for_source"].get(f, []))
        stem = Path(f).stem
        for cand in (f"tests/test_{stem}.py", f"tests/dialects/test_{stem}.py"):
            if (WS / cand).is_file():
                tests.add(cand)
    return sorted(t for t in tests if (WS / t).is_file())


def pytest_config():
    for name, marker in (("pytest.ini", None), (".pytest.ini", None), ("pyproject.toml", "[tool.pytest"),
                         ("tox.ini", "[pytest]"), ("setup.cfg", "[tool:pytest]")):
        p = WS / name
        if p.is_file() and (marker is None or marker in p.read_text(errors="replace")):
            return str(p)
    return os.devnull


def verify(changed, cfg, state):
    tests = related_tests(changed, cfg)
    py = tool("python")
    if not tests or not py or state["stop_blocks"] >= cfg.get("max_stop_blocks", 2):
        return [], tests
    # --tb=line -rf: the tail the agent sees is `FAILED <test> - <reason>` lines, not a traceback
    cmd = [py, "-m", "pytest", "-q", "-x", "--no-header", "--tb=line", "-rf", "-p", "no:cacheprovider", f"--rootdir={WS}",
           "-c", pytest_config(), f"--confcutdir={WS}", *tests]
    try:
        r = subprocess.run(cmd, cwd=WS, capture_output=True, text=True, timeout=600,
                           env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"))
    except subprocess.TimeoutExpired:
        return [], tests
    if r.returncode in (0, 5):  # 5: no tests collected
        return [], tests
    state["stop_blocks"] += 1
    tail = "\n".join((r.stdout + r.stderr).strip().splitlines()[-30:])
    note = cfg.get("wording", {}).get("verify") or "Fix them before finishing."
    return [f"verify: related tests fail ({' '.join(tests)}). {note}\n{tail}"], tests


def respond(event, msgs, feedback):
    if not msgs:
        return
    text = "Uplift checks:\n" + "\n\n".join(msgs)
    if event == "Stop" or feedback == "block_reason":
        out = {"decision": "block", "reason": text}
    else:
        out = {"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}}
    print(json.dumps(out))


def main():
    event = sys.argv[1] if len(sys.argv) > 1 else ""
    sys.stdin.read()  # payload unused: edited files come from git
    cfg = load("config.json", {})
    state = load("state.json", {"mtimes": {}, "warned": [], "stop_blocks": 0})
    checks = cfg.get("checks", [])
    changed = changed_files()
    msgs = []
    if event == "PostToolUse":
        fresh = [f for f in changed if state["mtimes"].get(f) != (WS / f).stat().st_mtime]
        state["mtimes"] = {f: (WS / f).stat().st_mtime for f in changed}
        if "lint" in checks:
            m = lint(fresh, cfg)
            log(event, "lint", bool(m), "\n".join(m) or " ".join(fresh))
            msgs += m
        if "cochange" in checks:
            m = cochange(changed, cfg, state)
            log(event, "cochange", bool(m), "\n".join(m))
            msgs += m
    elif event == "Stop" and "verify" in checks:
        m, tests = verify(changed, cfg, state)
        log(event, "verify", bool(m), "\n".join(m) or "ran: " + " ".join(tests))
        msgs += m
    (HERE / "state.json").write_text(json.dumps(state))
    respond(event, msgs, cfg.get("feedback", "block_reason"))


if __name__ == "__main__":
    main()
