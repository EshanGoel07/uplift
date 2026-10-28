"""Task workspaces: the repo exactly as it was before the fix, and nothing else.

The workspace is built from a `git archive` of the starting commit into a fresh
repo with a single commit. The agent can't `git log` its way to the real fix,
because no later history exists there.
"""

from __future__ import annotations

import io
import shutil
import subprocess
import tarfile
from pathlib import Path

from . import gitutil

EXCLUDES = [".venv/", ".uplift-run/", "__pycache__/", "*.pyc", ".pytest_cache/"]


def _sh(cwd: Path, *cmd: str, timeout: int = 1800) -> subprocess.CompletedProcess:
    return subprocess.run(list(cmd), cwd=cwd, capture_output=True, text=True, timeout=timeout)


def create(clone: Path, commit: str, dest: Path) -> Path:
    """Fresh, history-free repo at `dest` containing the tree of `commit`."""
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


def install_setup(ws: Path, setup_dir: Path) -> list[str]:
    """Copy a generated setup (AGENTS.md, .muse/hooks.json, scripts) into the workspace and
    commit it, so the agent's own changes can be diffed separately."""
    copied = []
    for src in sorted(setup_dir.rglob("*")):
        if src.is_file():
            rel = src.relative_to(setup_dir)
            dst = ws / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            copied.append(str(rel))
    if copied:
        gitutil.git(ws, "add", "-A")
        gitutil.git(ws, "commit", "-q", "-m", "uplift setup")
    return copied


def agent_diff(ws: Path) -> str:
    """Everything changed since the last commit, including new files (setup files excluded)."""
    gitutil.git(ws, "add", "-A")
    return gitutil.git(ws, "diff", "--cached", "HEAD")


def apply_patch(ws: Path, patch: str) -> bool:
    return gitutil.git_ok(ws, "apply", "-", input=patch)
