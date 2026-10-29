"""Fresh tasks: recent bug fixes mined straight from the repo's history.

SWE-rebench tasks are public, so a model may have seen them (and their fixes) in
training. Fresh tasks come from commits newer than the dataset:

* a first-parent, non-merge ``fix:``/``fix(...)`` commit on the default branch
  that changes library code (1..max_lib_files files) AND tests;
* ``patch`` = its non-test diff, ``test_patch`` = its ``tests/`` diff, base = its parent;
* the problem statement comes ONLY from the GitHub issue it closes. The commit
  message and diff describe the fix, so using them would leak it. No issue -> skip.
  (``gh issue view`` also answers for pull requests, whose body describes the fix,
  so the returned URL must be an ``/issues/`` URL. A PR squashed from a fork can say
  "Fixes #54" about the fork's tracker, so the issue must also be tied to the commit:
  closed by its PR, or closed around when it landed.)
* FAIL_TO_PASS / PASS_TO_PASS are measured, not trusted: the touched test files
  are run on base + tests (1) and base + tests + fix (2). F2P = failed in (1) and
  passed in (2); P2P = passed in both. No F2P -> skip.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from . import gitutil, grade as grade_mod, workspace
from .tasks import Task, _iso, files_in_patch

FIX_SUBJECT = re.compile(r"^(fix|Fix)(\(|:)")
_ISSUE_REF = re.compile(
    r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+"
    r"(?:https://github\.com/[\w.-]+/[\w.-]+/issues/|[\w.-]+/[\w.-]+#|#)(\d+)",
    re.I,
)


@dataclass
class Commit:
    sha: str
    parent: str
    date: str          # committer date, ISO-8601
    subject: str
    body: str
    files: list[str] = field(default_factory=list)


def is_library_file(path: str, lib_prefix: str) -> bool:
    return path.startswith(lib_prefix) and path.endswith(".py")


def is_test_file(path: str, test_prefix: str) -> bool:
    return path.startswith(test_prefix) and path.endswith(".py")


def filter_reason(c: Commit, lib_prefix: str = "sqlglot/", test_prefix: str = "tests/",
                  max_lib_files: int = 5) -> str | None:
    """Why a commit is not a candidate, or None if it is one."""
    if not FIX_SUBJECT.match(c.subject):
        return "subject is not a fix"
    lib = [f for f in c.files if is_library_file(f, lib_prefix)]
    if not lib:
        return "no library .py change"
    if len(lib) > max_lib_files:
        return f"more than {max_lib_files} library files"
    if not any(is_test_file(f, test_prefix) for f in c.files):
        return "no test .py change"
    return None


def linked_issue(subject: str, body: str) -> int | None:
    """Issue number from 'closes/fixes/resolves #N' (or an issues URL) in the message."""
    m = _ISSUE_REF.search(f"{subject}\n{body}")
    return int(m.group(1)) if m else None


def gh_issue(repo: str, number: int) -> dict | None:
    """`gh issue view`, or None on error. Includes `url` so PRs can be told apart, and dates /
    closing PRs so the issue can be tied to the commit."""
    proc = subprocess.run(["gh", "issue", "view", str(number), "--repo", repo, "--json",
                           "title,body,url,createdAt,closedAt,closedByPullRequestsReferences"],
                          capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        return None
    return json.loads(proc.stdout)


def pr_number(subject: str) -> int | None:
    """The squash-merge PR number: a trailing '(#N)' in the subject."""
    m = re.search(r"\(#(\d+)\)\s*$", subject)
    return int(m.group(1)) if m else None


def _ts(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def issue_matches_commit(data: dict, commit_date: str, pr: int | None) -> bool:
    """Is this issue really the one the commit fixes? A squashed PR from a fork can say
    'Fixes #54' about the FORK's issue tracker, which then names an unrelated upstream issue.
    Accept if the issue lists the commit's PR as a closer, or if it was opened before the commit
    and closed around when the commit landed (1 day before to 7 days after)."""
    if pr is not None and pr in [p.get("number") for p in data.get("closedByPullRequestsReferences") or []]:
        return True
    created, closed, landed = _ts(data.get("createdAt")), _ts(data.get("closedAt")), _ts(commit_date)
    if created is None or closed is None or created > landed:
        return False
    return landed - timedelta(days=1) <= closed <= landed + timedelta(days=7)


def problem_statement(repo: str, number: int, fetch=None, commit_date: str = "",
                      pr: int | None = None) -> tuple[str | None, str]:
    """(statement, skip reason). Only real issues count: a PR body describes the fix."""
    data = (fetch or gh_issue)(repo, number)
    if data is None:
        return None, "issue fetch failed"
    if "/issues/" not in (data.get("url") or ""):
        return None, "linked number is a pull request, not an issue"
    if not issue_matches_commit(data, commit_date, pr):
        return None, "issue not tied to this commit (closed at another time, not by its PR)"
    title, body = (data.get("title") or "").strip(), (data.get("body") or "").strip()
    if not title:
        return None, "issue has no title"
    return f"{title}\n\n{body}".strip(), ""


def list_commits(clone: Path, since: str, branch: str | None = None) -> list[Commit]:
    """First-parent, non-merge commits on the default branch since `since`, newest first."""
    branch = branch or gitutil.default_branch(clone)
    out = gitutil.git(clone, "log", "--first-parent", "--no-merges", f"--since={since}",
                      "--format=%H%x1f%P%x1f%cI%x1f%s%x1f%b%x1e", branch)
    commits = []
    for rec in out.split("\x1e"):
        rec = rec.strip("\n")
        if not rec:
            continue
        sha, parents, date, subject, body = rec.split("\x1f", 4)
        commits.append(Commit(sha, parents.split()[0] if parents else "", date, subject, body))
    return commits


def changed_files(clone: Path, c: Commit) -> list[str]:
    return [f for f in gitutil.git(clone, "diff", "--name-only", c.parent, c.sha).splitlines() if f]


def split_patches(clone: Path, parent: str, sha: str, test_prefix: str = "tests/") -> tuple[str, str]:
    """(patch, test_patch): the commit's diff outside / inside the test directory."""
    test_dir = test_prefix.rstrip("/")
    patch = gitutil.git(clone, "diff", "--no-color", "--binary", parent, sha, "--", ".", f":(exclude){test_dir}")
    test_patch = gitutil.git(clone, "diff", "--no-color", "--binary", parent, sha, "--", test_dir)
    return patch, test_patch


def test_modules(test_patch: str, test_prefix: str = "tests/") -> list[str]:
    """Touched test files pytest would collect (tests/**/test_*.py) that exist after the patch."""
    out = set()
    for block in re.split(r"^(?=diff --git )", test_patch, flags=re.M):
        m = re.match(r"diff --git a/\S+ b/(\S+)\n", block)
        if not m or re.search(r"^deleted file mode", block, re.M):
            continue
        path = m.group(1)
        if is_test_file(path, test_prefix) and Path(path).name.startswith("test_"):
            out.add(path)
    return sorted(out)


def f2p_p2p(before: dict[str, str], after: dict[str, str]) -> tuple[list[str], list[str]]:
    """F2P = failed/errored in (1) and passed in (2); P2P = passed in both."""
    ok = grade_mod._passed
    f2p = sorted(t for t, s in after.items() if ok(s) and before.get(t) in ("FAILED", "ERROR"))
    p2p = sorted(t for t, s in after.items() if ok(s) and ok(before.get(t)))
    return f2p, p2p


def measure(clone: Path, base: str, patch: str, test_patch: str, ws_dir: Path,
            python_version: str = "3.12", extras: str | None = None,
            test_prefix: str = "tests/", log_dir: Path | None = None) -> tuple[list[str], list[str], str]:
    """Run the touched test files on base+tests and base+tests+fix. Returns (f2p, p2p, skip reason).
    Raw pytest output of both runs is kept in `log_dir` (before.txt / after.txt)."""
    files = test_modules(test_patch, test_prefix)
    if not files:
        return [], [], "no runnable test module touched"

    def run(name: str) -> tuple[dict[str, str], str]:
        results, text = grade_mod.run_tests(ws, py, files)
        if log_dir:
            log_dir.mkdir(parents=True, exist_ok=True)
            (log_dir / f"{name}.txt").write_text(text)
        return results, grade_mod.check_output(text)

    try:
        ws = workspace.create(clone, base, ws_dir)
        py = workspace.install_env(ws, python_version, extras)
        start = gitutil.git(ws, "rev-parse", "HEAD").strip()
        if not workspace.apply_patch(ws, test_patch):
            return [], [], "test patch did not apply"
        before, problem = run("before")
        if problem:
            return [], [], f"pytest output check failed: {problem}"
        gitutil.git(ws, "reset", "-q", "--hard", start)
        gitutil.git(ws, "clean", "-qfd")
        if not workspace.apply_patch(ws, test_patch) or not workspace.apply_patch(ws, patch):
            return [], [], "fix did not apply"
        after, problem = run("after")
        if problem:
            return [], [], f"pytest output check failed: {problem}"
    except (RuntimeError, gitutil.GitError, subprocess.SubprocessError) as e:
        return [], [], f"error: {str(e)[:200]}"
    finally:
        shutil.rmtree(ws_dir, ignore_errors=True)
    f2p, p2p = f2p_p2p(before, after)
    if not f2p:
        return [], p2p, "no FAIL_TO_PASS test"
    return f2p, p2p, ""


@dataclass
class MineStats:
    scanned: int = 0
    accepted: int = 0
    skipped: Counter = field(default_factory=Counter)
    commits: list[dict] = field(default_factory=list)   # every scanned commit: sha + decision

    def record(self, sha: str, why: str) -> None:
        self.scanned += 1
        self.commits.append({"sha": sha, "decision": why or "accepted"})
        if why:
            self.skipped[why.split(":")[0]] += 1

    def to_dict(self) -> dict:
        return {"scanned": self.scanned, "accepted": self.accepted,
                "skipped": sum(self.skipped.values()), "skipped_by_reason": dict(self.skipped.most_common()),
                "commits": self.commits}


def mine(repo: str, clone: Path, since: str, limit: int, ws_root: Path, *, workers: int = 4,
         lib_prefix: str = "sqlglot/", test_prefix: str = "tests/", max_lib_files: int = 5,
         install: str | None = "pip install -e .[dev]", python_version: str = "3.12",
         branch: str | None = None, fetch_issue=None, measure_fn=None,
         log_root: Path | None = None) -> tuple[list[Task], MineStats]:
    """Newest-first scan; stops once `limit` tasks are accepted. `fetch_issue` / `measure_fn`
    replace the gh call / test runs in unit tests."""
    clone, ws_root = Path(clone).resolve(), Path(ws_root).resolve()
    measure_fn = measure_fn or measure
    extras = workspace.extras_from_install(install)
    stats, accepted = MineStats(), []

    def run(item):
        c, _, _, patch, test_patch = item
        return measure_fn(clone, c.parent, patch, test_patch, ws_root / "mine" / c.sha[:8],
                          python_version=python_version, extras=extras, test_prefix=test_prefix,
                          log_dir=Path(log_root) / c.sha[:8] if log_root else None)

    def flush(batch):
        with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
            for item, (f2p, p2p, why) in zip(batch, pool.map(run, batch)):
                if len(accepted) >= limit:
                    break
                c, issue, statement, patch, test_patch = item
                stats.record(c.sha, why)
                if why:
                    continue
                accepted.append(Task(
                    id=f"{repo.replace('/', '__')}-fresh-{c.sha[:8]}", repo=repo, source="mined",
                    created_at=_iso(c.date), base_commit=c.parent, problem_statement=statement,
                    patch=patch, test_patch=test_patch, fail_to_pass=f2p, pass_to_pass=p2p,
                    install=install, python=python_version, fix_files=files_in_patch(patch),
                    test_files=files_in_patch(test_patch),
                    meta={"commit": c.sha, "issue": issue, "subject": c.subject}))

    batch = []
    for c in list_commits(clone, since, branch):
        if len(accepted) >= limit:
            break
        if not c.parent:
            continue
        c.files = changed_files(clone, c)
        why = filter_reason(c, lib_prefix, test_prefix, max_lib_files)
        issue = linked_issue(c.subject, c.body) if not why else None
        if not why and issue is None:
            why = "no linked issue"
        statement = None
        if not why:
            statement, why = problem_statement(repo, issue, fetch_issue, c.date, pr_number(c.subject))
        if why:
            stats.record(c.sha, why)
            continue
        patch, test_patch = split_patches(clone, c.parent, c.sha, test_prefix)
        batch.append((c, issue, statement, patch, test_patch))
        if len(batch) >= max(1, workers):
            flush(batch)
            batch = []
    if batch and len(accepted) < limit:
        flush(batch)
    stats.accepted = len(accepted)
    return accepted, stats
