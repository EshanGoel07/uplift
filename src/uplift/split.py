"""Chronological dev/test split, plus the leakage cutoff.

* **test**: the newest tasks. Only these are reported.
* **dev**: the tasks just before them. Used for diagnosis and pruning.
* **snapshot**: the repo as it was before the earliest test task. The setup
  generator and risk map may only see this snapshot, its history, and review
  comments from before it, so no test-period fix can leak into the setup.

``check_leakage`` proves it: no test task's fix (or its tests) may already be
present in the snapshot.

* **fresh**: tasks mined after the dataset (``uplift mine-fresh``). They get their
  own snapshot (before the earliest fresh task) and their own leakage check.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from . import gitutil
from .tasks import Task


@dataclass
class Split:
    repo: str
    test_ids: list[str]
    dev_ids: list[str]
    unused_ids: list[str]
    cutoff: str                       # created_at of the earliest test task
    snapshot_commit: str = ""         # last default-branch commit before cutoff - margin
    snapshot_date: str = ""
    margin_days: int = 1
    leakage: dict[str, list[str]] = field(default_factory=dict)  # task id -> problems found
    # Fresh tasks (mined after the dataset). Their setup is built from their own snapshot.
    fresh_ids: list[str] = field(default_factory=list)
    fresh_cutoff: str = ""            # created_at of the earliest fresh task
    fresh_snapshot_commit: str = ""   # last default-branch commit before fresh_cutoff - margin
    fresh_snapshot_date: str = ""
    fresh_leakage: dict[str, list[str]] = field(default_factory=dict)

    @property
    def leak_free(self) -> bool:
        return not any(self.leakage.values()) and not any(self.fresh_leakage.values())

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(self), indent=2))

    @classmethod
    def load(cls, path: Path) -> "Split":
        return cls(**json.loads(path.read_text()))


def make_split(tasks: list[Task], test_n: int = 40, dev_n: int = 40) -> Split:
    if len(tasks) < test_n + dev_n:
        raise ValueError(f"need at least {test_n + dev_n} tasks, have {len(tasks)}")
    ordered = sorted(tasks, key=lambda t: (t.created_at, t.id))
    test = ordered[-test_n:]
    dev = ordered[-(test_n + dev_n):-test_n]
    unused = ordered[:-(test_n + dev_n)]
    return Split(
        repo=ordered[0].repo,
        test_ids=[t.id for t in test],
        dev_ids=[t.id for t in dev],
        unused_ids=[t.id for t in unused],
        cutoff=test[0].created_at,
    )


def snapshot_before(clone: Path, cutoff: str, margin_days: int = 1) -> tuple[str, str]:
    """(commit, date) of the last default-branch commit at least `margin_days` before `cutoff`."""
    before = datetime.fromisoformat(cutoff) - timedelta(days=margin_days)
    sha = gitutil.commit_before(clone, before.isoformat())
    return sha, gitutil.commit_date(clone, sha)


def attach_snapshot(split: Split, clone: Path, margin_days: int = 1) -> Split:
    split.snapshot_commit, split.snapshot_date = snapshot_before(clone, split.cutoff, margin_days)
    split.margin_days = margin_days
    return split


def leakage_at(snapshot: str, ids: list[str], tasks: list[Task], clone: Path, work: Path) -> dict[str, list[str]]:
    """For each task, confirm its fix and its new tests are NOT already in the snapshot."""
    by_id = {t.id: t for t in tasks}
    leakage: dict[str, list[str]] = {}
    with gitutil.Worktree(clone, snapshot, work / "snapshot-check") as wt:
        for tid in ids:
            t = by_id[tid]
            problems = []
            if gitutil.patch_already_present(wt, t.patch):
                problems.append("fix already present in snapshot")
            if gitutil.patch_already_present(wt, t.test_patch):
                problems.append("test changes already present in snapshot")
            leakage[tid] = problems
    return leakage


def check_leakage(split: Split, tasks: list[Task], clone: Path, work: Path) -> Split:
    """For every test task, confirm its fix and its new tests are NOT in the snapshot."""
    split.leakage = leakage_at(split.snapshot_commit, split.test_ids, tasks, clone, work)
    return split


def attach_fresh(split: Split, fresh: list[Task], clone: Path, work: Path, margin_days: int = 1) -> Split:
    """Record the fresh tasks, their own snapshot, and their leakage check against it."""
    ordered = sorted(fresh, key=lambda t: (t.created_at, t.id))
    split.fresh_ids = [t.id for t in ordered]
    split.fresh_cutoff = ordered[0].created_at if ordered else ""
    split.fresh_snapshot_commit = split.fresh_snapshot_date = ""
    split.fresh_leakage = {}
    if ordered:
        split.fresh_snapshot_commit, split.fresh_snapshot_date = \
            snapshot_before(clone, split.fresh_cutoff, margin_days)
        split.fresh_leakage = leakage_at(split.fresh_snapshot_commit, split.fresh_ids, ordered, clone, work)
    return split
