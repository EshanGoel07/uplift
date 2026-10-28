"""Chronological dev/test split, plus the leakage cutoff.

* **test**: the newest tasks. Only these are reported.
* **dev**: the tasks just before them. Used for diagnosis and pruning.
* **snapshot**: the repo as it was before the earliest test task. The setup
  generator and risk map may only see this snapshot, its history, and review
  comments from before it, so no test-period fix can leak into the setup.

``check_leakage`` proves it: no test task's fix (or its tests) may already be
present in the snapshot.
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

    @property
    def leak_free(self) -> bool:
        return not any(self.leakage.values())

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


def attach_snapshot(split: Split, clone: Path, margin_days: int = 1) -> Split:
    before = datetime.fromisoformat(split.cutoff) - timedelta(days=margin_days)
    split.snapshot_commit = gitutil.commit_before(clone, before.isoformat())
    split.snapshot_date = gitutil.commit_date(clone, split.snapshot_commit)
    split.margin_days = margin_days
    return split


def check_leakage(split: Split, tasks: list[Task], clone: Path, work: Path) -> Split:
    """For every test task, confirm its fix and its new tests are NOT in the snapshot."""
    by_id = {t.id: t for t in tasks}
    leakage: dict[str, list[str]] = {}
    with gitutil.Worktree(clone, split.snapshot_commit, work / "snapshot-check") as wt:
        for tid in split.test_ids:
            t = by_id[tid]
            problems = []
            if gitutil.patch_already_present(wt, t.patch):
                problems.append("fix already present in snapshot")
            if gitutil.patch_already_present(wt, t.test_patch):
                problems.append("test changes already present in snapshot")
            leakage[tid] = problems
    split.leakage = leakage
    return split
