"""Risk map from git history, using ONLY commits up to the snapshot (no leakage).

Outputs a *placement map*: where checks belong, not prose for the agent.

* per-file risk: recency-weighted fix frequency, churn, and bug-introducing
  commits found by SZZ-lite (blame the lines each fix deleted);
* co-change rules: "when A changes, B usually changes too", which become
  "edited A without B" checks;
* source -> test mapping: which tests to run after editing a file.

No model calls. Uplift reads the repo's history; it never runs the repo's code.
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from . import gitutil

FIX_RE = re.compile(r"^(fix|bugfix|hotfix)(\(|:|!|\s)|\b(fix(es|ed)?|bug|regression|crash)\b|closes? #\d+",
                    re.IGNORECASE)
SEP_COMMIT, SEP_FIELD = "\x1e", "\x1f"


@dataclass
class Commit:
    sha: str
    date: datetime
    author: str
    subject: str
    files: dict[str, tuple[int, int]] = field(default_factory=dict)  # path -> (added, deleted)

    @property
    def is_fix(self) -> bool:
        return bool(FIX_RE.search(self.subject))


def read_history(clone: Path, until: str) -> list[Commit]:
    """Non-merge commits reachable from `until` (the snapshot), newest first."""
    out = gitutil.git(clone, "log", "--no-merges", "--numstat", "-M",
                      f"--format={SEP_COMMIT}%H{SEP_FIELD}%cI{SEP_FIELD}%an{SEP_FIELD}%s", until)
    commits: list[Commit] = []
    for block in out.split(SEP_COMMIT):
        if not block.strip():
            continue
        header, _, body = block.partition("\n")
        sha, date, author, subject = header.split(SEP_FIELD, 3)
        c = Commit(sha, datetime.fromisoformat(date), author, subject)
        for line in body.splitlines():
            parts = line.split("\t")
            if len(parts) != 3:
                continue
            a, d, path = parts
            if "=>" in path:  # rename: keep the new path
                path = re.sub(r"\{[^{}]*=> ([^{}]*)\}", r"\1", path).replace("//", "/")
                path = path.split(" => ")[-1]
            c.files[path] = (int(a) if a.isdigit() else 0, int(d) if d.isdigit() else 0)
        commits.append(c)
    return commits


def _percentiles(values: dict[str, float]) -> dict[str, float]:
    if not values:
        return {}
    ordered = sorted(values.values())
    n = len(ordered)
    return {k: (sum(1 for x in ordered if x < v) + 0.5 * sum(1 for x in ordered if x == v)) / n
            for k, v in values.items()}


def szz_lite(clone: Path, fixes: list[Commit], is_source, limit: int = 200) -> Counter:
    """For the newest `limit` fix commits: blame the lines each fix deleted or changed
    in source files, at the fix's parent. Each blamed commit is a likely bug introducer;
    count how many distinct ones touched each file."""
    induced: dict[str, set[str]] = defaultdict(set)
    hunk = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@", re.M)
    for fx in fixes[:limit]:
        for path in fx.files:
            if not is_source(path):
                continue
            diff = gitutil.git(fx_repo := clone, "diff", "-U0", f"{fx.sha}^", fx.sha, "--", path, check=False)
            ranges = []
            for start, count in hunk.findall(diff):
                start, count = int(start), int(count) if count != "" else 1
                if count > 0:
                    ranges += ["-L", f"{start},{start + count - 1}"]
            if not ranges:
                continue
            blame = gitutil.git(fx_repo, "blame", "--porcelain", *ranges, f"{fx.sha}^", "--", path, check=False)
            for line in blame.splitlines():
                m = re.match(r"^([0-9a-f]{40}) \d+ \d+", line)
                if m and m.group(1) != fx.sha:
                    induced[path].add(m.group(1))
    return Counter({p: len(s) for p, s in induced.items()})


def build_risk_map(clone: Path, snapshot: str, *, source_prefix: str = "", test_prefix: str = "tests/",
                   half_life_days: float = 180, max_files_per_commit: int = 10,
                   min_support: int = 5, min_confidence: float = 0.5, szz_limit: int = 200) -> dict:
    commits = read_history(clone, snapshot)
    if not commits:
        raise ValueError("no history before snapshot")
    snap_date = commits[0].date

    def is_py(p):
        return p.endswith(".py")

    def is_test(p):
        return is_py(p) and (p.startswith(test_prefix) or "/tests/" in p or p.split("/")[-1].startswith("test_"))

    def is_source(p):
        return is_py(p) and not is_test(p) and p.startswith(source_prefix)

    churn, fixes_w, commits_n, authors = Counter(), Counter(), Counter(), defaultdict(set)
    pair, single = Counter(), Counter()
    fix_commits = []
    for c in commits:
        age = (snap_date - c.date).total_seconds() / 86400
        w = math.exp(-math.log(2) * max(age, 0) / half_life_days)
        py = [p for p in c.files if is_py(p)]
        for p in py:
            a, d = c.files[p]
            churn[p] += w * (a + d)
            commits_n[p] += 1
            authors[p].add(c.author)
            if c.is_fix:
                fixes_w[p] += w
        if c.is_fix:
            fix_commits.append(c)
        if 2 <= len(py) <= max_files_per_commit:
            for p in py:
                single[p] += 1
            for i, a in enumerate(sorted(py)):
                for b in sorted(py)[i + 1:]:
                    pair[(a, b)] += 1

    induced = szz_lite(clone, fix_commits, is_source, limit=szz_limit) if szz_limit else Counter()

    # Files that still exist at the snapshot
    alive = set(gitutil.git(clone, "ls-tree", "-r", "--name-only", snapshot).split())
    sources = [p for p in commits_n if is_source(p) and p in alive]
    pf, pc, pi = (_percentiles({p: m[p] for p in sources}) for m in (fixes_w, churn, induced))
    score = {p: round((pf[p] + pc[p] + pi[p]) / 3, 4) for p in sources}
    ranked = sorted(sources, key=lambda p: -score[p])

    rules, tests_for = [], defaultdict(list)
    for (a, b), n in pair.items():
        if n < min_support or a not in alive or b not in alive:
            continue
        for x, y in ((a, b), (b, a)):
            conf = n / single[x]
            if conf >= min_confidence:
                rule = {"if_edited": x, "expect_also": y, "support": n, "confidence": round(conf, 3)}
                if is_source(x) and is_test(y):
                    tests_for[x].append(rule)
                elif is_source(x) and is_source(y):
                    rules.append(rule)
    for x in tests_for:
        tests_for[x].sort(key=lambda r: -r["confidence"])
    rules.sort(key=lambda r: (-r["confidence"], -r["support"]))

    top_n = max(1, round(0.2 * len(ranked)))
    return {
        "snapshot": snapshot,
        "snapshot_date": snap_date.isoformat(),
        "commits_analysed": len(commits),
        "fix_commits": len(fix_commits),
        "szz_fixes_blamed": min(szz_limit, len(fix_commits)) if szz_limit else 0,
        "params": {"half_life_days": half_life_days, "max_files_per_commit": max_files_per_commit,
                   "min_support": min_support, "min_confidence": min_confidence},
        "files": [{"path": p, "risk": score[p], "fix_weight": round(fixes_w[p], 3),
                   "churn_weight": round(churn[p], 1), "bug_introducers": induced[p],
                   "commits": commits_n[p], "authors": len(authors[p])} for p in ranked],
        "top_risk_files": ranked[:top_n],
        "co_change_rules": rules,
        "tests_for_source": {k: [r["expect_also"] for r in v] for k, v in tests_for.items()},
    }


def save(risk: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(risk, indent=2))
