"""Split site/data/results.json into light files for the website.

    python scripts/split_results.py        (run from site/)

Reads site/data/results.json (the source of truth, written by `uplift export`) and never modifies it.
Writes, under site/public/data/:
  summary.json        summary, arms, trust and per-task metadata (no issue text, no diffs)
  tasks/<id>.json     one task each, exactly as in the source (issue, 6 arms x 2 runs, diffs, hooks)
  results.json        byte-for-byte copy, served as the raw-data download

Deterministic: same input, same bytes out. Safe to rerun. Standard library only.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
SRC = SITE / "data" / "results.json"
OUT = SITE / "public" / "data"


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def dump(obj, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    path.write_text(text + "\n", encoding="utf-8", newline="\n")


def main() -> int:
    before = sha256(SRC)
    data = json.loads(SRC.read_text(encoding="utf-8"))
    arm_ids = [a["id"] for a in data["arms"]]

    tasks_meta = []
    for t in data["tasks"]:
        res = t["results"]
        if sorted(res) != sorted(arm_ids):
            raise SystemExit(f"{t['id']}: arms {sorted(res)} != {sorted(arm_ids)}")
        solved = {}
        for a in arm_ids:
            runs = res[a]["runs"]
            if len(runs) != 2:
                raise SystemExit(f"{t['id']}/{a}: expected 2 runs, got {len(runs)}")
            n = sum(bool(r["resolved"]) for r in runs)
            if n != res[a]["solved"]:
                raise SystemExit(f"{t['id']}/{a}: solved {res[a]['solved']} != resolved runs {n}")
            solved[a] = n
        total = sum(solved.values())
        outcomes = 2 * len(arm_ids)
        group = "always" if total == outcomes else "never" if total == 0 else "mixed"
        tasks_meta.append({
            "id": t["id"],
            "set": t["set"],
            "title": t["title"],
            "solved": solved,
            "total": total,
            "group": group,
            "hooksFired": any(r["hooks"] for a in arm_ids for r in res[a]["runs"]),
            "cost": round(sum(r["cost_usd"] for a in arm_ids for r in res[a]["runs"]), 6),
        })
        dump(t, OUT / "tasks" / f"{t['id']}.json")

    summary = {
        "summary": data["summary"],
        "arms": data["arms"],
        "trust": data["trust"],
        "tasks": tasks_meta,
    }
    dump(summary, OUT / "summary.json")
    shutil.copyfile(SRC, OUT / "results.json")

    # Remove task files for ids no longer in the source (keeps reruns exact).
    keep = {f"{t['id']}.json" for t in data["tasks"]}
    for f in (OUT / "tasks").glob("*.json"):
        if f.name not in keep:
            f.unlink()

    after = sha256(SRC)
    if before != after:
        raise SystemExit("results.json changed while splitting: refusing")
    size = (OUT / "summary.json").stat().st_size
    print(f"source sha256 {after[:16]}  tasks {len(tasks_meta)}  summary.json {size:,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
