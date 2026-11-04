"""Thin wrappers around git. Uplift only *reads* the target repo's history and
files; it never runs the target repo's code outside a sandbox."""

from __future__ import annotations

import subprocess
from pathlib import Path


class GitError(RuntimeError):
    pass


def git(repo: Path, *args: str, check: bool = True, input: str | None = None) -> str:
    proc = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, input=input)
    if check and proc.returncode != 0:
        raise GitError(f"git {' '.join(args)} failed: {proc.stderr.strip()[:500]}")
    return proc.stdout


def git_ok(repo: Path, *args: str, input: str | None = None) -> bool:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True,
                          input=input).returncode == 0


def default_branch(repo: Path) -> str:
    for ref in ("refs/remotes/origin/HEAD",):
        out = git(repo, "symbolic-ref", "--quiet", "--short", ref, check=False).strip()
        if out:
            return out
    for name in ("origin/main", "origin/master", "main", "master"):
        if git_ok(repo, "rev-parse", "--verify", "--quiet", name):
            return name
    raise GitError("could not determine the default branch")


def commit_before(repo: Path, iso_datetime: str, branch: str | None = None) -> str:
    """Last first-parent commit on the default branch committed strictly before the given time."""
    branch = branch or default_branch(repo)
    sha = git(repo, "rev-list", "-1", "--first-parent", f"--before={iso_datetime}", branch).strip()
    if not sha:
        raise GitError(f"no commit on {branch} before {iso_datetime}")
    return sha


def commit_date(repo: Path, sha: str) -> str:
    return git(repo, "show", "-s", "--format=%cI", sha).strip()


def is_ancestor(repo: Path, a: str, b: str) -> bool:
    return git_ok(repo, "merge-base", "--is-ancestor", a, b)


class Worktree:
    """A throwaway detached worktree at a given commit (removed on exit)."""

    def __init__(self, repo: Path, sha: str, path: Path):
        # Absolute paths: `git -C <repo>` would otherwise resolve a relative path inside the repo.
        self.repo, self.sha, self.path = Path(repo).resolve(), sha, Path(path).resolve()

    def __enter__(self) -> Path:
        if self.path.exists():
            git(self.repo, "worktree", "remove", "--force", str(self.path), check=False)
        git(self.repo, "worktree", "add", "--detach", "--force", str(self.path), self.sha)
        return self.path

    def __exit__(self, *exc) -> None:
        git(self.repo, "worktree", "remove", "--force", str(self.path), check=False)
        git(self.repo, "worktree", "prune", check=False)


def ensure_commit(repo: Path, sha: str) -> bool:
    """Make sure a commit exists locally; PR-branch commits may need an explicit fetch."""
    if git_ok(repo, "cat-file", "-e", f"{sha}^{{commit}}"):
        return True
    git(repo, "fetch", "--quiet", "origin", sha, check=False)
    return git_ok(repo, "cat-file", "-e", f"{sha}^{{commit}}")


def patch_already_present(worktree: Path, patch: str) -> bool:
    """True if the patch's changes are already in the tree (it reverse-applies cleanly)."""
    if not patch.strip():
        return False
    return git_ok(worktree, "apply", "--reverse", "--check", "-", input=patch)


def patch_applies(worktree: Path, patch: str) -> bool:
    if not patch.strip():
        return False
    return git_ok(worktree, "apply", "--check", "-", input=patch)
