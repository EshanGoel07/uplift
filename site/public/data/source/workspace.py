"""Task workspaces: the repo exactly as it was before the fix, and nothing else.

The workspace is built from a `git archive` of the starting commit into a fresh
repo with a single commit. The agent can't `git log` its way to the real fix,
because no later history exists there.
"""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import tarfile
from pathlib import Path

from . import gitutil

EXCLUDES = [".venv/", ".uplift-run/", "__pycache__/", "*.pyc", ".pytest_cache/", "*.egg-info/",
            # guard logs: never part of the agent's patch, even if they land in the workspace
            "guard_summary.json", "stdout.jsonl", "stderr_trace.log"]


def _sh(cwd: Path, *cmd: str, timeout: int = 1800) -> subprocess.CompletedProcess:
    return subprocess.run(list(cmd), cwd=cwd, capture_output=True, text=True, timeout=timeout)


def create(clone: Path, commit: str, dest: Path) -> Path:
    """Fresh, history-free repo at `dest` containing the tree of `commit`."""
    # Absolute paths: later steps run commands from INSIDE the workspace, where a
    # relative path like `.uplift/workspaces/...` would point somewhere else.
    clone, dest = Path(clone).resolve(), Path(dest).resolve()
    if not gitutil.ensure_commit(clone, commit):
        raise gitutil.GitError(f"commit {commit} not available in {clone}")
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    archive = subprocess.run(["git", "-C", str(clone), "archive", "--format=tar", commit],
                             capture_output=True, check=True).stdout
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(dest, filter="data")
    gitutil.git(dest, "init", "-q", "-b", "main")
    gitutil.git(dest, "config", "user.email", "uplift@localhost")
    gitutil.git(dest, "config", "user.name", "uplift")
    (dest / ".git" / "info").mkdir(parents=True, exist_ok=True)
    (dest / ".git" / "info" / "exclude").write_text("\n".join(EXCLUDES) + "\n")
    gitutil.git(dest, "add", "-A")
    gitutil.git(dest, "commit", "-q", "-m", "start")
    return dest


def install_env(ws: Path, python_version: str = "3.12", extras: str | None = None) -> Path:
    """Create .venv inside the workspace with uv and install the package + pytest.
    Returns the interpreter path."""
    r = _sh(ws, "uv", "venv", "-q", "-p", python_version, ".venv")
    if r.returncode != 0:
        raise RuntimeError(f"uv venv failed: {r.stderr[-800:]}")
    py = ws / ".venv" / "bin" / "python"
    target = f".[{extras}]" if extras else "."
    r = _sh(ws, "uv", "pip", "install", "-q", "--python", str(py), "-e", target, "pytest")
    if r.returncode != 0 and extras:  # extras can pin things that no longer resolve; fall back
        r = _sh(ws, "uv", "pip", "install", "-q", "--python", str(py), "-e", ".", "pytest")
    if r.returncode != 0:
        raise RuntimeError(f"install failed: {r.stderr[-800:]}")
    return py


def extras_from_install(install: str | None) -> str | None:
    """'pip install -e .[dev]' -> 'dev'."""
    if install and "[" in install and "]" in install:
        return install.split("[", 1)[1].split("]", 1)[0] or None
    return None


# Agent instruction/config files. The repo's own copies are removed before an arm is installed
# (sqlglot added AGENTS.md / CLAUDE.md in 2026, so fresh tasks would otherwise start with them,
# and "none" would not be none), and these paths never count as the agent's change.
AGENT_PATHS = ["AGENTS.md", "CLAUDE.md", ".muse", ".claude", ".cursorrules", ".cursor",
               ".github/copilot-instructions.md"]


def install_arm(ws: Path, arm_dir: Path | None) -> dict:
    """Strip the repo's own agent files, copy an arm's files (AGENTS.md, .muse/...) into the
    workspace, fill in `{WORKSPACE}` in .muse/hooks.json, and commit, so the agent's own changes
    can be diffed separately. `arm_dir` None = no files (the "none" arm)."""
    ws = Path(ws).resolve()
    # lexists: sqlglot's CLAUDE.md is a symlink to AGENTS.md, and a dangling one must go too
    stripped = [p for p in AGENT_PATHS if os.path.lexists(ws / p)]
    for p in stripped:
        path = ws / p
        shutil.rmtree(path) if path.is_dir() and not path.is_symlink() else path.unlink()
    copied = []
    for src in sorted(Path(arm_dir).rglob("*")) if arm_dir else []:
        rel = src.relative_to(arm_dir)
        if not src.is_file() or str(rel) == "MANIFEST.json":
            continue
        dst = ws / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        if str(rel) == ".muse/hooks.json":
            dst.write_text(dst.read_text().replace("{WORKSPACE}", str(ws)))
        copied.append(str(rel))
    # A stripped file can be untracked (a global gitignore keeps it out of the start commit, as
    # ~/.gitignore_global does CLAUDE.md here): there is then no removal to stage, and git add fails.
    tracked = [p for p in stripped if gitutil.git(ws, "ls-files", "--", p).strip()]
    if tracked or copied:
        gitutil.git(ws, "add", "-A", "-f", "--", *(tracked + copied))
        gitutil.git(ws, "commit", "-q", "-m", "uplift arm")
    return {"copied": copied, "stripped": stripped}


def agent_diff(ws: Path) -> str:
    """Everything changed since the last commit, including new files, except arm/agent files
    (AGENTS.md, .muse/ hook state, ...), which are never part of the agent's patch."""
    gitutil.git(ws, "add", "-A")
    return gitutil.git(ws, "diff", "--cached", "HEAD", "--", ".",
                       *[f":(exclude){p}" for p in AGENT_PATHS])


def apply_patch(ws: Path, patch: str) -> bool:
    return gitutil.git_ok(ws, "apply", "-", input=patch)
