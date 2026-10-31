"""Setup generator: Muse Spark writes a repo-specific AGENTS.md and the settings for three hook
checks (lint after edit, co-change warning, verify before finishing), from material dated
strictly before the test snapshot. Uplift renders the hooks itself, so their format is always
valid and every check is backed by data (the risk map), not by prose.

Leakage rules (the point of the split):

* inputs: the snapshot's files, its own history, the risk map built from that history, and
  GitHub review comments created by the snapshot's date on PRs merged by then. Every input item
  carries a date; ``assert_before`` refuses to send anything dated after the cutoff;
* one setup per arm, built once, used for both test and fresh tasks;
* every input, prompt, response and parsed output is saved with dates, for auditing.

The model is called through the budget proxy only (``UPLIFT_PROXY``, which adds the key).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import gitutil

MODEL = "muse-spark-1.3-contributor"
MAX_AGENTS_LINES = 30
DOCS = ["README.md", "CONTRIBUTING.md", "Makefile", ".pre-commit-config.yaml", "setup.py", "setup.cfg",
        "pyproject.toml"]
AGENT_FILES = ["AGENTS.md", "CLAUDE.md", ".muse", ".claude", ".cursorrules", ".cursor", ".github/copilot-instructions.md"]
HOOK_SCRIPT = Path(__file__).parent / "arm_hooks" / "uplift_hook.py"
ARMS = {  # arm -> (AGENTS.md?, enabled checks)
    "none": (False, []),
    "prose": (True, []),
    "sensors": (False, ["lint", "cochange", "verify"]),
    "both": (True, ["lint", "cochange", "verify"]),
    "lint-only": (False, ["lint"]),          # ablations: dev only
    "cochange-only": (False, ["cochange"]),
    "verify-only": (False, ["verify"]),
}


class LeakageError(RuntimeError):
    pass


def _dt(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def filter_before(items: list[dict], cutoff: str, *keys: str) -> tuple[list[dict], int]:
    """Keep items whose every date field in `keys` is present and at or before `cutoff` (the
    snapshot commit's own date: the snapshot itself is allowed, nothing after it)."""
    c, kept = _dt(cutoff), []
    for it in items:
        if all(it.get(k) and _dt(it[k]) <= c for k in keys):
            kept.append(it)
    return kept, len(items) - len(kept)


def assert_before(inputs: dict, cutoff: str) -> None:
    """Every dated item anywhere in the inputs must be at or before the cutoff."""
    c, bad = _dt(cutoff), []

    def walk(x, path):
        if isinstance(x, dict):
            for k, v in x.items():
                if k.endswith("date") or k.endswith("_at"):
                    if isinstance(v, str) and v and _dt(v) > c:
                        bad.append(f"{path}.{k}={v}")
                walk(v, f"{path}.{k}")
        elif isinstance(x, list):
            for i, v in enumerate(x):
                walk(v, f"{path}[{i}]")
    walk(inputs, "inputs")
    if bad:
        raise LeakageError(f"{len(bad)} input item(s) dated after the cutoff {cutoff}: {bad[:5]}")


def gh_json(args: list[str]) -> object:
    proc = subprocess.run(["gh", "api", *args], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(f"gh api {' '.join(args)} failed: {proc.stderr[-300:]}")
    return json.loads(proc.stdout)


def review_comments(repo: str, cutoff: str, *, days: int = 180, max_prs: int = 40, max_comments: int = 150,
                    gh=gh_json) -> tuple[list[dict], dict]:
    """Inline review comments created before `cutoff`, on PRs merged before it (most-discussed
    PRs of the `days` before the cutoff). Bots and empty bodies are dropped."""
    end = _dt(cutoff).astimezone(timezone.utc)
    start = end - timedelta(days=days)
    q = f"repo:{repo} is:pr is:merged merged:{start:%Y-%m-%d}..{end:%Y-%m-%d}"
    found = gh(["-X", "GET", "search/issues", "-f", f"q={q}", "-f", "sort=comments", "-f", "order=desc",
                "-f", f"per_page={max_prs}"])
    prs = [{"number": it["number"], "title": it["title"], "created_at": it["created_at"],
            "merged_at": (it.get("pull_request") or {}).get("merged_at")} for it in found.get("items", [])]
    prs, dropped_prs = filter_before(prs, cutoff, "created_at", "merged_at")
    out, dropped = [], 0
    for pr in prs:
        for c in gh([f"repos/{repo}/pulls/{pr['number']}/comments", "-X", "GET", "-f", "per_page=100"]):
            user = c.get("user") or {}
            if user.get("type") == "Bot" or not (c.get("body") or "").strip():
                continue
            out.append({"pr": pr["number"], "pr_title": pr["title"], "pr_merged_at": pr["merged_at"],
                        "path": c.get("path"), "created_at": c.get("created_at"),
                        "body": c["body"].strip()[:400]})
    out, dropped = filter_before(out, cutoff, "created_at", "pr_merged_at")
    out.sort(key=lambda c: c["created_at"], reverse=True)
    return out[:max_comments], {"prs_considered": len(prs), "prs_dropped_by_date": dropped_prs,
                                "comments_dropped_by_date": dropped, "query": q}


_DEV_HEADING = re.compile(r"test|lint|develop|contribut|style|setup|install", re.I)


def _show(clone: Path, sha: str, path: str, limit: int) -> str | None:
    if not gitutil.git_ok(clone, "cat-file", "-e", f"{sha}:{path}"):
        return None
    text = gitutil.git(clone, "show", f"{sha}:{path}")
    if path.lower().startswith("readme") and len(text) > limit:
        # READMEs are mostly usage docs: keep the intro plus the developer-facing `##` sections.
        parts = re.split(r"(?m)^(?=## )", text)
        keep = [parts[0][:1500]] + [p for p in parts[1:] if _DEV_HEADING.search(p.splitlines()[0])]
        text = "\n".join(keep)
    return text[:limit]


def collect_inputs(repo: str, clone: Path, snapshot: str, risk: dict, *, gh=gh_json, lib_prefix: str = "",
                   test_prefix: str = "tests/") -> dict:
    """Everything the generator may see, each item dated. The cutoff is the snapshot's commit date."""
    clone = Path(clone).resolve()
    cutoff = gitutil.commit_date(clone, snapshot)
    if risk.get("snapshot") != snapshot:
        raise LeakageError(f"risk map was built at {risk.get('snapshot')}, not the snapshot {snapshot}")
    lib_prefix = lib_prefix or repo.split("/")[1] + "/"
    tree = gitutil.git(clone, "ls-tree", "-r", "--name-only", snapshot).splitlines()
    history = []
    for line in gitutil.git(clone, "log", "--first-parent", "-n", "150", "--format=%H%x1f%cI%x1f%s",
                            snapshot).splitlines():
        sha, date, subject = line.split("\x1f", 2)
        history.append({"sha": sha[:10], "date": date, "subject": subject})
    history, dropped_hist = filter_before(history, cutoff, "date")
    comments, cstats = review_comments(repo, cutoff, gh=gh)
    inputs = {
        "repo": repo,
        "snapshot": {"commit": snapshot, "date": cutoff},
        "docs": {p: t for p in DOCS if (t := _show(clone, snapshot, p, 6000)) is not None},
        "tree": {"library": [p for p in tree if p.startswith(lib_prefix) and p.endswith(".py")],
                 "tests": [p for p in tree if p.startswith(test_prefix) and p.endswith(".py")]},
        "history": history,
        "risk": {"snapshot_date": risk.get("snapshot_date"), "top_risk_files": risk.get("top_risk_files"),
                 "files": [{k: f[k] for k in ("path", "risk", "fix_weight", "bug_introducers")}
                           for f in risk.get("files", [])[:25]],
                 "co_change_rules": risk.get("co_change_rules", []),
                 "tests_for_source": risk.get("tests_for_source", {})},
        "review_comments": comments,
        "filter_stats": {"history_dropped_by_date": dropped_hist, **cstats},
    }
    assert_before(inputs, cutoff)
    return inputs


SYSTEM = """You write the setup for an AI coding agent that will fix bugs in one repository.
You are given the repository as it was at a snapshot: key docs, its file tree, recent commit
subjects, a risk map mined from its git history, and maintainers' code-review comments.
Be specific to THIS repository. No generic advice ("write clean code", "add tests")."""

INSTRUCTIONS = """Return ONE JSON object, no prose around it, with exactly these keys:

"agents_md": the AGENTS.md text, at most 30 lines. Repo-specific: the most fragile files and why,
  files that must change together, how to run the relevant tests and the linter, and conventions
  that reviewers enforce (cite what you saw in the review comments).
"lint": {"ruff_check_args": [extra args for `ruff check`, taken from the repo's own config],
         "format_line_length": integer or null (from the repo's own ruff-format config),
         "why": short}
"cochange": a list of {"if_edited": path, "expect_also": path, "message": one sentence for the agent},
  chosen ONLY from the co_change_rules given (same paths); keep the ones a reviewer would care about.
"verify": {"extra_tests_for_source": {source path: [test paths]} for important sources the given
  tests_for_source mapping misses (only test paths that exist in the tree), "why": short}
"""


def build_messages(inputs: dict) -> list[dict]:
    return [{"role": "system", "content": SYSTEM},
            {"role": "user", "content": INSTRUCTIONS + "\n\nINPUTS (JSON):\n" + json.dumps(inputs)}]


def call_model(messages: list[dict], *, base_url: str | None = None, model: str = MODEL,
               max_tokens: int = 4000, timeout: int = 600) -> dict:
    """One chat completion through the budget proxy (which holds the key; we send `dummy`)."""
    base = (base_url or os.environ.get("UPLIFT_PROXY") or "http://127.0.0.1:8787").rstrip("/")
    body = json.dumps({"model": model, "messages": messages, "max_tokens": max_tokens,
                       "temperature": 0}).encode()
    req = urllib.request.Request(f"{base}/v1/chat/completions", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer dummy"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def parse_spec(text: str, inputs: dict) -> tuple[dict, list[str]]:
    """Parse and validate the model's JSON. Returns (spec, problems); problems make it unusable."""
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return {}, ["no JSON object in the response"]
    try:
        spec = json.loads(m.group(0))
    except ValueError as e:
        return {}, [f"invalid JSON: {e}"]
    problems = []
    agents = (spec.get("agents_md") or "").strip()
    if not agents:
        problems.append("agents_md is empty")
    elif len(agents.splitlines()) > MAX_AGENTS_LINES:
        problems.append(f"agents_md has {len(agents.splitlines())} lines (max {MAX_AGENTS_LINES})")
    rules = {(r["if_edited"], r["expect_also"]) for r in inputs["risk"]["co_change_rules"]}
    spec["cochange"] = [c for c in spec.get("cochange") or []
                        if isinstance(c, dict) and (c.get("if_edited"), c.get("expect_also")) in rules]
    lint = spec.get("lint") or {}
    args = [a for a in lint.get("ruff_check_args") or [] if isinstance(a, str) and re.fullmatch(r"--?[\w=.,-]+|[A-Z]+\d+", a)]
    ll = lint.get("format_line_length")
    spec["lint"] = {"ruff_check_args": args, "format_line_length": ll if isinstance(ll, int) else None,
                    "why": lint.get("why", "")}
    tests = set(inputs["tree"]["tests"])
    extra = (spec.get("verify") or {}).get("extra_tests_for_source") or {}
    spec["verify"] = {"extra_tests_for_source": {s: [t for t in ts if t in tests] for s, ts in extra.items()
                                                 if isinstance(ts, list)},
                      "why": (spec.get("verify") or {}).get("why", "")}
    spec["agents_md"] = agents
    return spec, problems


def hook_config(checks: list[str], spec: dict, risk: dict, feedback: str) -> dict:
    tests = {k: list(v) for k, v in (risk.get("tests_for_source") or {}).items()}
    for s, ts in spec["verify"]["extra_tests_for_source"].items():
        tests.setdefault(s, [])
        tests[s] += [t for t in ts if t not in tests[s]]
    return {"checks": checks, "feedback": feedback, "lint": spec["lint"], "cochange": spec["cochange"],
            "tests_for_source": tests, "max_stop_blocks": 2, "wording": spec.get("wording", {})}


def hooks_json(checks: list[str]) -> dict:
    """Muse `.muse/hooks.json`: `{"hooks": {<event>: [matcher groups]}}`. The hook probe showed the
    event map must sit under a top-level "hooks" key (a bare event map is silently ignored).
    `{WORKSPACE}` is filled in when the arm is installed."""
    cmd = "python3 {WORKSPACE}/.muse/uplift_hooks/uplift_hook.py"
    out = {}
    if {"lint", "cochange"} & set(checks):
        out["PostToolUse"] = [{"hooks": [{"type": "command", "command": f"{cmd} PostToolUse", "timeout": 120}]}]
    if "verify" in checks:
        out["Stop"] = [{"hooks": [{"type": "command", "command": f"{cmd} Stop", "timeout": 900}]}]
    return {"hooks": out}


def render_arms(spec: dict, risk: dict, out_root: Path, *, feedback: str = "additional_context",
                generator_run: str = "", arms: dict = ARMS) -> dict[str, list[str]]:
    """Write one directory per arm under `out_root`. Returns {arm: files}."""
    written = {}
    for arm, (with_agents, checks) in arms.items():
        d = Path(out_root) / arm
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True)
        files = []
        if with_agents:
            (d / "AGENTS.md").write_text(spec["agents_md"].rstrip() + "\n")
            files.append("AGENTS.md")
        if checks:
            h = d / ".muse" / "uplift_hooks"
            h.mkdir(parents=True)
            (d / ".muse" / "hooks.json").write_text(json.dumps(hooks_json(checks), indent=2) + "\n")
            (h / "config.json").write_text(json.dumps(hook_config(checks, spec, risk, feedback), indent=2) + "\n")
            shutil.copy2(HOOK_SCRIPT, h / "uplift_hook.py")
            files += [".muse/hooks.json", ".muse/uplift_hooks/config.json", ".muse/uplift_hooks/uplift_hook.py"]
        manifest = {"arm": arm, "files": files, "checks": checks, "agents_md": with_agents,
                    "generator_run": generator_run,
                    "sha256": {f: hashlib.sha256((d / f).read_bytes()).hexdigest() for f in files}}
        (d / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
        written[arm] = files
    return written


_PATH = re.compile(r"(?<![\w/.-])((?:[\w.-]+/)+[\w.-]+\.(?:py|sql|md|toml|cfg|yaml|yml))")


def paths_named(spec: dict, risk: dict | None = None) -> dict[str, list[str]]:
    """Every file path the setup names: in the generated rules (AGENTS.md text, co-change rules,
    extra test mapping), and in the risk-map test mapping the verify hook also uses."""
    gen = set(_PATH.findall(spec.get("agents_md", "")))
    for c in spec.get("cochange", []):
        gen |= {c["if_edited"], c["expect_also"]}
    for s, ts in spec.get("verify", {}).get("extra_tests_for_source", {}).items():
        gen |= {s, *ts}
    mapped = set()
    for s, ts in ((risk or {}).get("tests_for_source") or {}).items():
        mapped |= {s, *ts}
    return {"generated": sorted(gen), "risk_test_mapping": sorted(mapped - gen)}


def check_paths(clone: Path, commit: str, paths: list[str], prefixes: tuple[str, ...] = ("",)) -> list[str]:
    """Paths that do not exist at `commit` (reported, never silently fixed). A path also counts
    as present under one of `prefixes` (the model writes `dialects/x.py` for `sqlglot/dialects/x.py`)."""
    return [p for p in paths
            if not any(gitutil.git_ok(clone, "cat-file", "-e", f"{commit}:{pre}{p}") for pre in prefixes)]
