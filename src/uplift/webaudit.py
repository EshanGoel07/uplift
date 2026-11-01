"""What did each run reach on the network? Free and offline: reads the saved traces.

Workspaces have no git history, but Muse Code has web tools and its shell has network access, so an
agent can fetch the real fix from upstream (`curl .../pull/4347.diff`). The snapshot leakage checks
can't see that. This audit reads every tool call in a run's trace and gives the run one tier, the
worst it reached:

  1 own_fix        a diff of the task's own fix (its PR's .diff/.patch/files, or its fix commit)
  2 upstream_code  newer sqlglot code: a raw upstream file, a commit after the task's base, or pip
  3 own_page       the task's own PR page, without a diff
  4 other_page     some other sqlglot PR or issue
  5 clean          docs only, or no web at all

A call only counts if it looks successful. This is a lower bound: a URL built at run time, or a
search result snippet, is not seen. Traces are slow to read, so results are cached in
.uplift/<repo>/web_audit/<plan>.json.
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from . import analysis, batch as batch_mod, gitutil

TIERS = {1: "own_fix", 2: "upstream_code", 3: "own_page", 4: "other_page", 5: "clean"}
LABELS = {1: "The task's own fix diff", 2: "Newer upstream code", 3: "The task's own PR page",
          4: "Another sqlglot PR or issue", 5: "Docs only, or no web"}
EXPOSED = (1, 2)     # the run could copy the answer
WEB_TOOLS = ("muse.web_fetch", "muse.bash")
_REPO_URL = re.compile(r"(?:github\.com|githubusercontent\.com)/(?:repos/|raw/)?tobymao/sqlglot")
_URL = re.compile(r"https?://[^\s\"'\\)]+")
_DIFF = re.compile(r"\.diff|\.patch|/files|patch-diff")
_RAW = re.compile(r"raw\.githubusercontent\.com/tobymao/sqlglot/|/raw/|/blob/")
_COMMIT = re.compile(r"/commits?/([0-9a-f]{7,40})")
_FAILED = re.compile(r"Sign in to GitHub|Page not found|404: Not Found|HTTP Error 4|API rate limit|\"exit_code\": [1-9]", re.I)
_PIP = re.compile(r"(?:pip3?|uv pip) +(?:install|download)[^;&|\n]*sqlglot")
_TESTS = re.compile(r"\bpytest\b|\bunittest\b|python3? +-m +tests?\b|make +(?:unit|test)")


def fix_pr(task) -> str | None:
    """SWE-rebench ids end in the PR number; mined tasks have it at the end of the commit subject."""
    if "-fresh-" not in task.id:
        return task.id.rsplit("-", 1)[1]
    m = re.search(r"\(#(\d+)\)\s*$", task.meta.get("subject", ""))
    return m.group(1) if m else None


def tool_calls(run_dir: Path) -> list[dict]:
    """Every tool call in the run: {"name", "args", "output"}. Requests repeat the conversation, so
    calls are keyed by id; the agent's own turns are the only ones with function_call items."""
    calls: dict[str, dict] = {}
    outputs: dict[str, str] = {}
    for line in analysis.read_trace(run_dir).split("\n"):
        if line.startswith("REQUEST:") and '"function_call"' in line:
            try:
                items = json.loads(line[len("REQUEST:"):]).get("input", [])
            except ValueError:
                continue
            for it in items:
                if isinstance(it, dict) and it.get("type") == "function_call":
                    calls[it["call_id"]] = {"name": it.get("name"), "args": it.get("arguments") or ""}
                elif isinstance(it, dict) and it.get("type") == "function_call_output":
                    out = it.get("output")
                    outputs[it.get("call_id")] = (out if isinstance(out, str) else json.dumps(out))[:2000]
    return [dict(c, output=outputs.get(cid, "")) for cid, c in calls.items()]


def url_tier(url: str, pr: str | None, sha: str, is_future) -> int:
    own = (pr and re.search(rf"/(?:pull|pulls|issues)/{pr}(?:\D|$)", url)) or (sha and sha[:7] in url)
    commit = _COMMIT.search(url)
    if own:
        return 1 if _DIFF.search(url) or commit else 3
    if commit:
        return 2 if is_future(commit.group(1)) else 4
    return 2 if _RAW.search(url) else 4


def classify(calls: list[dict], pr: str | None, sha: str, is_future) -> dict:
    """{"tier", "ran_tests", "urls": [(tier, url)]}. `is_future(sha)`: not in the task's base history."""
    tier, found, ran = 5, [], False
    for c in calls:
        args = c["args"]
        if c["name"] == "muse.bash" and _TESTS.search(args):
            ran = True
        if c["name"] not in WEB_TOOLS:
            continue
        ok = bool(c["output"]) and not _FAILED.search(c["output"][:1500])
        if ok and c["name"] == "muse.bash" and _PIP.search(args):
            tier = min(tier, 2)
            found.append((2, "pip: sqlglot"))
        for url in _URL.findall(args):
            if ok and _REPO_URL.search(url):
                t = url_tier(url, pr, sha, is_future)
                tier = min(tier, t)
                found.append((t, url[:120]))
    return {"tier": tier, "ran_tests": ran, "urls": sorted(set(found))}


def _audit_one(job: tuple) -> dict:
    key, run_dir, pr, sha, base, clone = job

    def is_future(commit: str) -> bool:      # an unknown commit counts as newer: it can't be shown to be old
        return not gitutil.git_ok(Path(clone), "merge-base", "--is-ancestor", commit, base)

    return dict(zip(("task", "arm", "seed"), key), **classify(tool_calls(Path(run_dir)), pr, sha, is_future))


def audit(d: Path, runs: list[dict], tasks: dict, clone: Path, workers: int = 8) -> list[dict]:
    jobs = []
    for r in sorted(runs, key=str):
        t = tasks[r["task"]]
        jobs.append(((r["task"], r["arm"], r["seed"]), str(batch_mod.run_path(d / "runs", r)), fix_pr(t),
                     t.meta.get("commit", ""), t.base_commit, str(clone)))
    with ProcessPoolExecutor(max_workers=max(1, workers)) as pool:
        return list(pool.map(_audit_one, jobs, chunksize=8))


def path_for(d: Path, plan_path: Path) -> Path:
    return d / "web_audit" / f"{Path(plan_path).stem}.json"


def load(d: Path, plan_path: Path) -> list[dict]:
    p = path_for(d, plan_path)
    if not p.exists():
        raise SystemExit(f"no web audit at {p}: run `uplift web-audit` first")
    return json.loads(p.read_text())


def by_run(rows: list[dict]) -> dict[tuple, dict]:
    return {(r["task"], r["arm"], r["seed"]): r for r in rows}


def exposed_tasks(rows: list[dict], tiers=EXPOSED) -> set[str]:
    return {r["task"] for r in rows if r["tier"] in tiers}


def trust_summary(batch: analysis.Batch, rows: list[dict]) -> dict:
    """What the site's trust card says about the web, from the audit."""
    per_arm = [sum(r["arm"] == a and r["tier"] in EXPOSED for r in rows) for a in batch.arms]
    keep = [t for t in batch.tasks if t not in exposed_tasks(rows)]
    clean = analysis.bootstrap(analysis.per_task(batch, keep))
    return {"exposed": sum(per_arm), "lo": min(per_arm), "hi": max(per_arm), "clean_tasks": len(keep),
            "clean_clear": any(v["diff_ci"][0] > 0 or v["diff_ci"][1] < 0 for a, v in clean.items() if a != analysis.BASE)}


def sensitivity(batch: analysis.Batch, rows: list[dict]) -> list[dict]:
    """The arm comparison again, under ways of removing what the web gave."""
    seen = by_run(rows)
    worst = {a: [sum(batch.results[(t, a, s)]["resolved"] and seen[(t, a, s)]["tier"] not in EXPOSED
                     for s in batch.seeds) / len(batch.seeds) for t in batch.tasks] for a in batch.arms}
    views = [("All tasks", analysis.per_task(batch), len(batch.tasks))]
    for name, tiers in (("Without tasks where any run saw the fix or newer code", EXPOSED),
                        ("Also without tasks where any run saw its own PR page", (1, 2, 3))):
        keep = [t for t in batch.tasks if t not in exposed_tasks(rows, tiers)]
        views.append((name, analysis.per_task(batch, keep), len(keep)))
    views.append(("All tasks, with every exposed run counted as failed", worst, len(batch.tasks)))
    return [{"view": name, "tasks": n, "arms": analysis.bootstrap(matrix)} for name, matrix, n in views]
