"""Run one task: validate it (real fix) or attempt it with an agent (with or without a setup)."""

from __future__ import annotations

import gzip
import json
import os
import shlex
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import gitutil, grade as grade_mod, screen, workspace
from .tasks import Task

PROMPT = """You are working in a Python repository. Fix the issue below so the code behaves as described.

Rules:
- Change the library code to fix the issue. Do not edit or delete existing tests (you may add new ones).
- Keep the change minimal and consistent with the surrounding code.
- When you're done, stop.

<issue>
{problem}
</issue>
"""

# The agent's network policy, applied by Muse Code itself (flags on `muse exec`, this run only).
#   --sandbox-network restricted   its shell has no network, not even Muse's default "approved
#                                  hosts" proxy, which let `curl github.com` through (Phase 5).
#   web_fetch off, web_search off  these run in Muse or at the provider, outside the shell sandbox.
# Unknown or clashing settings make Muse refuse the run, so a typo can't leave the network open.
# Not sandbox-exec: it can't allow one remote host, and Muse's own model calls go to api.meta.ai.
# The guard (reserve and settle at the proxy), pip installs and grading run outside all of this.
NETWORK_POLICY = "blocked"
NETWORK_ARGS = ("--sandbox-network", "restricted",
                "--config", "tools.web_fetch.enabled=false",
                "--config", 'tools.web_search.mode="off"')


def muse_args(prompt: str) -> list[str]:
    """Arguments for `muse exec`. Every agent run goes through here, so none can skip the block."""
    return ["--trust-workspace", "--disable-approval", *NETWORK_ARGS, prompt]


@dataclass
class RunResult:
    task_id: str
    arm: str
    seed: int
    resolved: bool
    grade: dict
    agent_exit: int | None = None
    agent_end: str = ""                                # how Muse says the run ended, if it failed
    seconds: float = 0.0
    cost_usd: float | None = None
    tokens: dict = field(default_factory=dict)
    patch_lines: int = 0
    error: str = ""
    arm_files: list = field(default_factory=list)      # copied into the workspace
    stripped: list = field(default_factory=list)       # repo's own agent files removed first
    hooks: dict = field(default_factory=dict)          # {check: {"runs": n, "fired": n}}
    f2p_excluded: list = field(default_factory=list)   # screened out: don't count towards `resolved`
    network: str = ""                                  # NETWORK_POLICY; "" in runs that predate it


def _start_ref(ws: Path) -> str:
    return gitutil.git(ws, "rev-list", "--max-parents=0", "HEAD").split()[0]


def prepare(task: Task, clone: Path, ws_root: Path, name: str, python_version: str) -> tuple[Path, Path, str]:
    ws = workspace.create(clone, task.base_commit, ws_root / task.id / name)
    py = workspace.install_env(ws, python_version, workspace.extras_from_install(task.install))
    return ws, py, _start_ref(ws)


def validate(task: Task, clone: Path, ws_root: Path, repeats: int = 3, python_version: str = "3.12",
             log_dir: Path | None = None) -> dict:
    """A task is valid if, on every repeat: before the fix, at least one FAIL_TO_PASS test fails;
    after applying the real fix, all FAIL_TO_PASS and PASS_TO_PASS tests pass. Output that fails
    the pytest cross-check counts as neither. Raw pytest output goes to `log_dir` (kept after
    the workspace is deleted, so results can be re-parsed offline)."""
    before_ok, after_ok, notes = [], [], []
    ws, py, start = prepare(task, clone, ws_root, "validate", python_version)
    log_dir = Path(log_dir) if log_dir else ws / ".uplift-run"
    shutil.rmtree(log_dir, ignore_errors=True)  # no stale logs from an earlier run with more repeats
    for i in range(repeats):
        gitutil.git(ws, "reset", "-q", "--hard", start)
        gitutil.git(ws, "clean", "-qfd")
        g0 = grade_mod.grade(ws, py, start, task.test_patch, task.test_files, task.fail_to_pass,
                             task.pass_to_pass, log_path=log_dir / f"before-{i}.txt")
        before_ok.append(g0.test_patch_applied and not g0.error and bool(g0.f2p_failed))
        if not before_ok[-1]:
            notes.append(f"before fix: test patch applied={g0.test_patch_applied}; "
                         f"F2P already passing={g0.f2p_passed[:3]} {g0.error}")
        gitutil.git(ws, "reset", "-q", "--hard", start)
        gitutil.git(ws, "clean", "-qfd")
        if not workspace.apply_patch(ws, task.patch):
            notes.append("real fix did not apply")
            after_ok.append(False)
            continue
        g1 = grade_mod.grade(ws, py, start, task.test_patch, task.test_files, task.fail_to_pass,
                             task.pass_to_pass, log_path=log_dir / f"after-{i}.txt")
        after_ok.append(g1.resolved)
        if not g1.resolved:
            notes.append(f"after fix: f2p_failed={g1.f2p_failed[:3]} p2p_failed={g1.p2p_failed[:3]} {g1.error}")
    valid = all(before_ok) and all(after_ok)
    return {"task_id": task.id, "valid": valid, "repeats": repeats,
            "fails_before": before_ok, "passes_after": after_ok, "notes": notes[:5]}


def hook_counts(log: Path) -> dict:
    """{check: {"runs": n, "fired": n}} from the sensor hooks' log (empty if no hook ran)."""
    out: dict = {}
    if log.exists():
        for line in log.read_text().splitlines():
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            c = out.setdefault(rec.get("check", "?"), {"runs": 0, "fired": 0})
            c["runs"] += 1
            c["fired"] += bool(rec.get("fired"))
    return out


def agent_end(run_dir: Path) -> str:
    """Muse's own last word on a failed run, e.g. `run ended with Failed: model did not reach a
    terminal state within 40 step(s)` ("" if there is none). Batch runs have the trace gzipped."""
    plain, packed = Path(run_dir) / "stderr_trace.log", Path(run_dir) / "stderr_trace.log.gz"
    if plain.exists():
        text = plain.read_text(errors="replace")
    elif packed.exists():
        with gzip.open(packed, "rt", errors="replace") as f:
            text = f.read()
    else:
        return ""
    return next((ln.strip() for ln in reversed(text.splitlines()) if ln.startswith("run ended with")), "")


def infra_failure(rc: int, hard_killed: bool, timeout: int, kill_grace: int, patch: str, summary: dict,
                  guarded: bool) -> str:
    """Why this run can't be graded, or "". A non-zero exit alone is not such a reason: Muse exits 1
    when it uses up its step limit, with real work left in the workspace (5 dev runs: the Stop hook
    blocked the agent at step 33-39 of 40). Those are graded like any run, with `agent_exit` kept."""
    if hard_killed:
        return f"hard-killed after {timeout + kill_grace}s (guard did not exit; cost not settled)"
    if rc == 124:
        return f"agent timed out after {timeout}s"
    if rc == 0:
        return ""
    if guarded and not summary:
        return f"guard failed: exit {rc} and no guard_summary.json"
    if rc < 0 or summary.get("exit_code", 0) < 0 or rc == 127:
        return f"agent exited {summary.get('exit_code', rc)} (killed or never started)"
    return "" if patch.strip() else f"agent exited {rc} with no patch"


def attempt(task: Task, clone: Path, ws_root: Path, run_dir: Path, *, arm: str, setup_dir: Path | None,
            seed: int, guard: Path, max_steps: int = 40, timeout: int = 2400, trust_usage: bool = True,
            python_version: str = "3.12", agent_cmd: str | None = None, kill_grace: int = 180,
            excluded_f2p=()) -> RunResult:
    """One agent attempt. Muse Code runs through guarded_muse.py (budget cap enforced).
    `agent_cmd` replaces the agent for tests only.

    Timeouts: the guard kills Muse after `timeout` s and still settles the real cost (exit 124).
    As a backstop, the whole process group is killed `kill_grace` s later. Either way the run is
    recorded as an error and never graded, so a timed-out run can't count as a pass. See
    `infra_failure` for what else is an error rather than a graded run.

    `excluded_f2p`: F2P tests the screen left out. All tests still run and `grade` holds the raw
    result; `resolved` ignores the excluded ones."""
    # Absolute paths: the agent/guard runs with cwd=ws, where a relative run_dir would
    # make the guard write its logs (and cost summary) inside the workspace instead.
    run_dir, ws_root = Path(run_dir).resolve(), Path(ws_root).resolve()
    run_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    ws, py, start = prepare(task, clone, ws_root, f"{arm}-s{seed}", python_version)
    installed = workspace.install_arm(ws, setup_dir)
    if setup_dir and (Path(setup_dir) / "MANIFEST.json").exists():
        shutil.copy2(Path(setup_dir) / "MANIFEST.json", run_dir / "arm_manifest.json")
    hook_log = run_dir / "hooks.jsonl"
    hook_log.unlink(missing_ok=True)
    prompt = PROMPT.format(problem=task.problem_statement.strip())
    (run_dir / "prompt.txt").write_text(prompt)

    if agent_cmd:
        cmd = shlex.split(agent_cmd) + [prompt]
        network = "not applied (test agent)"
    else:
        cmd = [sys.executable, str(guard), "--log-dir", str(run_dir), "--max-steps", str(max_steps),
               "--timeout", str(timeout)] + (["--trust-usage"] if trust_usage else []) + \
              ["--", *muse_args(prompt)]
        network = NETWORK_POLICY
    proc = subprocess.Popen(cmd, cwd=ws, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            env=dict(os.environ, UPLIFT_HOOK_LOG=str(hook_log), MUSE_NO_AUTO_UPDATE="1"),
                            start_new_session=True)
    hard_killed = False
    try:
        out, err = proc.communicate(timeout=timeout + kill_grace)
    except subprocess.TimeoutExpired:  # the guard itself didn't exit: kill guard + muse + hooks
        hard_killed = True
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        out, err = proc.communicate()
    (run_dir / "agent_stdout.txt").write_text((out or "")[-200_000:])
    (run_dir / "agent_stderr.txt").write_text((err or "")[-200_000:])
    rc = proc.returncode

    if rc in (3, 4):  # refused by the budget / proxy unreachable: the agent never ran, so no result.json
        return RunResult(task.id, arm, seed, False, {}, agent_exit=rc,
                         error="refused by budget cap" if rc == 3 else "budget proxy unreachable",
                         seconds=round(time.time() - t0, 1), arm_files=installed["copied"],
                         stripped=installed["stripped"], network=network)

    ws_log = ws / ".muse" / "uplift_hooks" / "fired.jsonl"
    if not hook_log.exists() and ws_log.exists():  # Muse doesn't pass env to hooks (hook probe)
        shutil.copy2(ws_log, hook_log)
    patch = workspace.agent_diff(ws)
    (run_dir / "agent.patch").write_text(patch)
    summary = {}
    if (run_dir / "guard_summary.json").exists():
        summary = json.loads((run_dir / "guard_summary.json").read_text())
    end = agent_end(run_dir)
    why = infra_failure(rc, hard_killed, timeout, kill_grace, patch, summary, guarded=not agent_cmd)
    if why:  # not graded, so never a pass
        res = RunResult(task.id, arm, seed, False, {}, agent_exit=rc, agent_end=end, error=why,
                        seconds=round(time.time() - t0, 1), cost_usd=summary.get("parsed_cost_usd"),
                        tokens=summary.get("tokens", {}), patch_lines=patch.count("\n"),
                        arm_files=installed["copied"], stripped=installed["stripped"], hooks=hook_counts(hook_log),
                        network=network)
        (run_dir / "result.json").write_text(json.dumps(asdict(res), indent=2))
        return res
    g = grade_mod.grade(ws, py, start, task.test_patch, task.test_files, task.fail_to_pass,
                        task.pass_to_pass, log_path=run_dir / "grade_pytest.txt")
    res = RunResult(task.id, arm, seed, screen.resolved(g.to_dict(), excluded_f2p), g.to_dict(),
                    agent_exit=rc, agent_end=end, f2p_excluded=list(excluded_f2p), seconds=round(time.time() - t0, 1), cost_usd=summary.get("parsed_cost_usd"),
                    tokens=summary.get("tokens", {}), patch_lines=patch.count("\n"),
                    arm_files=installed["copied"], stripped=installed["stripped"], hooks=hook_counts(hook_log),
                    network=network)
    (run_dir / "result.json").write_text(json.dumps(asdict(res), indent=2))
    return res


def regrade(task: Task, clone: Path, ws_root: Path, run_dir: Path, python_version: str = "3.12") -> dict:
    """Grade a finished run offline: agent.patch on a fresh workspace, no model calls. The patch
    is applied as saved, so the test reset in `grade` still removes any test edits. The old
    result is kept as result.before_regrade.json."""
    run_dir, ws_root = Path(run_dir).resolve(), Path(ws_root).resolve()
    old = json.loads((run_dir / "result.json").read_text())
    ws, py, start = prepare(task, clone, ws_root, f"regrade-{old['arm']}-s{old['seed']}", python_version)
    try:
        if not workspace.apply_patch(ws, (run_dir / "agent.patch").read_text()):
            raise RuntimeError(f"{run_dir}: agent.patch did not apply to a fresh workspace")
        g = grade_mod.grade(ws, py, start, task.test_patch, task.test_files, task.fail_to_pass,
                            task.pass_to_pass, log_path=run_dir / "grade_pytest.txt")
    finally:
        shutil.rmtree(ws, ignore_errors=True)
    shutil.copy2(run_dir / "result.json", run_dir / "result.before_regrade.json")
    new = dict(old, resolved=g.resolved, grade=g.to_dict(), error="", regraded=True, agent_end=agent_end(run_dir))
    (run_dir / "result.json").write_text(json.dumps(new, indent=2))
    return new
