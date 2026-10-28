"""Run one task: validate it (real fix) or attempt it with an agent (with or without a setup)."""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import gitutil, grade as grade_mod, workspace
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


@dataclass
class RunResult:
    task_id: str
    arm: str
    seed: int
    resolved: bool
    grade: dict
    agent_exit: int | None = None
    seconds: float = 0.0
    cost_usd: float | None = None
    tokens: dict = field(default_factory=dict)
    patch_lines: int = 0
    error: str = ""


def _start_ref(ws: Path) -> str:
    return gitutil.git(ws, "rev-list", "--max-parents=0", "HEAD").split()[0]


def prepare(task: Task, clone: Path, ws_root: Path, name: str, python_version: str) -> tuple[Path, Path, str]:
    ws = workspace.create(clone, task.base_commit, ws_root / task.id / name)
    py = workspace.install_env(ws, python_version, workspace.extras_from_install(task.install))
    return ws, py, _start_ref(ws)


def validate(task: Task, clone: Path, ws_root: Path, repeats: int = 3, python_version: str = "3.12") -> dict:
    """A task is valid if, on every repeat: before the fix, at least one FAIL_TO_PASS test fails;
    after applying the real fix, all FAIL_TO_PASS and PASS_TO_PASS tests pass."""
    before_ok, after_ok, notes = [], [], []
    ws, py, start = prepare(task, clone, ws_root, "validate", python_version)
    for i in range(repeats):
        gitutil.git(ws, "reset", "-q", "--hard", start)
        gitutil.git(ws, "clean", "-qfd")
        g0 = grade_mod.grade(ws, py, start, task.test_patch, task.test_files, task.fail_to_pass, task.pass_to_pass)
        before_ok.append(g0.test_patch_applied and bool(g0.f2p_failed))
        gitutil.git(ws, "reset", "-q", "--hard", start)
        gitutil.git(ws, "clean", "-qfd")
        if not workspace.apply_patch(ws, task.patch):
            notes.append("real fix did not apply")
            after_ok.append(False)
            continue
        g1 = grade_mod.grade(ws, py, start, task.test_patch, task.test_files, task.fail_to_pass, task.pass_to_pass)
        after_ok.append(g1.resolved)
        if not g1.resolved:
            notes.append(f"after fix: f2p_failed={g1.f2p_failed[:3]} p2p_failed={g1.p2p_failed[:3]} {g1.error}")
    valid = all(before_ok) and all(after_ok)
    return {"task_id": task.id, "valid": valid, "repeats": repeats,
            "fails_before": before_ok, "passes_after": after_ok, "notes": notes[:5]}


def attempt(task: Task, clone: Path, ws_root: Path, run_dir: Path, *, arm: str, setup_dir: Path | None,
            seed: int, guard: Path, max_steps: int = 40, timeout: int = 1800, trust_usage: bool = True,
            python_version: str = "3.12", agent_cmd: str | None = None) -> RunResult:
    """One agent attempt. Muse Code runs through guarded_muse.py (budget cap enforced).
    `agent_cmd` replaces the agent for tests only."""
    run_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    ws, py, start = prepare(task, clone, ws_root, f"{arm}-s{seed}", python_version)
    if setup_dir:
        workspace.install_setup(ws, setup_dir)
    prompt = PROMPT.format(problem=task.problem_statement.strip())
    (run_dir / "prompt.txt").write_text(prompt)

    if agent_cmd:
        cmd = shlex.split(agent_cmd) + [prompt]
    else:
        cmd = [sys.executable, str(guard), "--log-dir", str(run_dir), "--max-steps", str(max_steps),
               "--timeout", str(timeout)] + (["--trust-usage"] if trust_usage else []) + \
              ["--", "--trust-workspace", "--disable-approval", prompt]
    proc = subprocess.run(cmd, cwd=ws, capture_output=True, text=True, env=os.environ.copy())
    (run_dir / "agent_stdout.txt").write_text(proc.stdout[-200_000:])
    (run_dir / "agent_stderr.txt").write_text(proc.stderr[-200_000:])

    if proc.returncode == 3:  # refused by the budget: the agent never ran
        return RunResult(task.id, arm, seed, False, {}, agent_exit=3, error="refused by budget cap",
                         seconds=round(time.time() - t0, 1))

    patch = workspace.agent_diff(ws)
    (run_dir / "agent.patch").write_text(patch)
    g = grade_mod.grade(ws, py, start, task.test_patch, task.test_files, task.fail_to_pass,
                        task.pass_to_pass, log_path=run_dir / "grade_pytest.txt")
    summary = {}
    if (run_dir / "guard_summary.json").exists():
        summary = json.loads((run_dir / "guard_summary.json").read_text())
    res = RunResult(task.id, arm, seed, g.resolved, g.to_dict(), agent_exit=proc.returncode,
                    seconds=round(time.time() - t0, 1), cost_usd=summary.get("parsed_cost_usd"),
                    tokens=summary.get("tokens", {}), patch_lines=patch.count("\n"))
    (run_dir / "result.json").write_text(json.dumps(asdict(res), indent=2))
    return res
