"""Task records: a past bug fix turned into a test-graded task.

A task is only usable if specific tests fail before the fix and pass after it
(SWE-bench's FAIL_TO_PASS rule). Sources:

* ``swe-rebench``: pre-validated tasks from the SWE-rebench dataset (CC-BY-4.0),
  each with a Docker image that already has the repo's dependencies installed.
* ``mined``: fresh tasks built by Uplift's own strict miner (later phase).
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

SWE_REBENCH_FILTERED = (
    "https://huggingface.co/api/datasets/nebius/SWE-rebench/parquet/default/filtered/0.parquet"
)

_DIFF_FILE = re.compile(r"^diff --git a/(\S+) b/(\S+)$", re.M)


@dataclass
class Task:
    id: str
    repo: str
    source: str
    created_at: str                      # ISO-8601, UTC
    base_commit: str                     # repo state the agent starts from (bug present)
    problem_statement: str
    patch: str                           # the real fix (hidden from the agent)
    test_patch: str                      # tests added/changed by the fix (hidden until grading)
    fail_to_pass: list[str]              # must fail before the fix, pass after
    pass_to_pass: list[str]              # must pass both before and after (regression guard)
    docker_image: str | None = None
    test_cmd: str | None = None
    python: str | None = None
    install: str | None = None
    license: str | None = None
    hints_text: str = ""
    fix_files: list[str] = field(default_factory=list)    # files the real fix touches
    test_files: list[str] = field(default_factory=list)   # files the test patch touches
    meta: dict = field(default_factory=dict)

    @property
    def created(self) -> datetime:
        return datetime.fromisoformat(self.created_at)

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)

    @classmethod
    def from_dict(cls, d: dict) -> "Task":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in d.items() if k in known})


def files_in_patch(patch: str) -> list[str]:
    """Paths touched by a unified git diff, in order, without duplicates."""
    seen: list[str] = []
    for a, b in _DIFF_FILE.findall(patch or ""):
        for p in (b, a):
            if p != "/dev/null" and p not in seen:
                seen.append(p)
                break
    return seen


def _iso(value) -> str:
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _as_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return [str(x) for x in parsed] if isinstance(parsed, list) else [value]
        except ValueError:
            return [value]
    return [str(x) for x in value]


def download(url: str, cache_dir: Path) -> Path:
    """Download once into the cache; later calls reuse the file."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / url.rstrip("/").split("/datasets/")[-1].replace("/", "__")
    if not target.exists() or target.stat().st_size == 0:
        tmp = target.with_suffix(target.suffix + ".part")
        with urllib.request.urlopen(url, timeout=600) as r, open(tmp, "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
        os.replace(tmp, target)
    return target


def load_swe_rebench(repo: str, parquet_files: list[Path]) -> list[Task]:
    """Read SWE-rebench rows for one repo and turn them into Task records.

    Only rows with a Docker image and at least one FAIL_TO_PASS test are kept.
    """
    import pyarrow as pa
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    tables = []
    for p in parquet_files:
        t = pq.read_table(p)
        tables.append(t.filter(pc.equal(t["repo"], repo)))
    table = pa.concat_tables(tables, promote_options="permissive") if len(tables) > 1 else tables[0]

    tasks: dict[str, Task] = {}
    for row in table.to_pylist():
        f2p = _as_list(row.get("FAIL_TO_PASS"))
        image = row.get("docker_image") or row.get("image_name")
        if not f2p or not image or row["instance_id"] in tasks:
            continue
        cfg = row.get("install_config") or {}
        meta = row.get("meta") or {}
        tasks[row["instance_id"]] = Task(
            id=row["instance_id"],
            repo=repo,
            source="swe-rebench",
            created_at=_iso(row["created_at"]),
            base_commit=row["base_commit"],
            problem_statement=row.get("problem_statement") or "",
            hints_text=row.get("hints_text") or "",
            patch=row.get("patch") or "",
            test_patch=row.get("test_patch") or "",
            fail_to_pass=f2p,
            pass_to_pass=_as_list(row.get("PASS_TO_PASS")),
            docker_image=image,
            test_cmd=cfg.get("test_cmd"),
            python=cfg.get("python"),
            install=cfg.get("install"),
            license=row.get("license_name"),
            fix_files=files_in_patch(row.get("patch") or ""),
            test_files=files_in_patch(row.get("test_patch") or ""),
            meta={
                "version": row.get("version"),
                "llm_score": (meta or {}).get("llm_score"),
                "num_modified_files": (meta or {}).get("num_modified_files"),
            },
        )
    return sorted(tasks.values(), key=lambda t: t.created_at)


def save_tasks(tasks: list[Task], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w") as f:
        for t in tasks:
            f.write(t.to_json() + "\n")
    os.replace(tmp, path)


def read_tasks(path: Path) -> list[Task]:
    with open(path) as f:
        return [Task.from_dict(json.loads(line)) for line in f if line.strip()]
