"""Task screening: does the issue describe what each FAIL_TO_PASS test checks?

A dataset's F2P list comes from the whole fix commit, so a bundled commit can demand behaviour the
issue never mentions, and no setup can help with that (Phase 3 pilot: 0/16 on two such tasks).

Muse Spark sees the issue text and the lines the fix commit added to one test, nothing else: no fix,
no run results, no arm names. This module never reads the runs folder.

Rule, fixed before looking at arm results: keep F2P tests judged yes or partly; exclude "no" tests
from F2P (they do not move to PASS_TO_PASS); drop tasks left with no F2P test. A test with no added
lines to show can't be judged and is kept. Grading itself never changes: the same tests run and
the raw per-test grade stays in result.json. An excluded test just doesn't count.

Every prompt and response is saved under .uplift/<repo>/screen/<task id>/.
"""

from __future__ import annotations

import ast
import hashlib
import json
import random
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from . import generate as gen, gitutil
from .tasks import Task

RULE = ('keep F2P tests judged yes or partly; exclude "no" tests from F2P (not moved to P2P); '
        "drop tasks left with no F2P test; tests with no added lines cannot be judged and are kept")
MAX_TOKENS = 8000            # Muse Spark's hidden reasoning counts against this
MAX_LINES_CHARS = 12_000     # a huge fixture diff is cut, and the record says so
# Estimate only (the proxy meters the real cost). USD per 1M tokens for muse-spark-1.3-contributor.
USD_PER_M_INPUT, USD_PER_M_OUTPUT = 0.10, 0.20
EST_OUTPUT_TOKENS, CHARS_PER_TOKEN = 3000, 3.0

SYSTEM = "You check benchmark tasks. You see one issue and some lines added to a test. Judge only from these."
QUESTION = ("Does the issue describe or directly imply the behaviour these lines check? "
            "yes / no / partly, plus a one-line reason.")
FORMAT = 'Return one JSON object, no prose around it: {"verdict": "yes" | "no" | "partly", "reason": "<one line>"}'
_HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


@dataclass
class PatchedFile:
    lines: list[str]                                  # the file after the patch
    added: dict[int, str] = field(default_factory=dict)   # 1-based line number -> added text


def parse_hunks(patch: str) -> dict[str, list[tuple[int, int, list[str]]]]:
    """{path: [(old start, old count, body lines)]} from a unified diff."""
    files: dict[str, list] = {}
    current = None
    for line in patch.split("\n"):   # not splitlines(): SQL fixtures can hold \x0c and friends
        if line.startswith("diff --git "):
            current = files.setdefault(line.split(" b/", 1)[1], [])
        elif current is not None and (m := _HUNK.match(line)):
            current.append((int(m.group(1)), int(m.group(2) or 1), []))
        elif current and line[:1] in (" ", "+", "-"):
            current[-1][2].append(line)
    return files


def apply_hunks(base: str, hunks: list[tuple[int, int, list[str]]]) -> PatchedFile:
    old, new, added, pos = base.split("\n") if base else [], [], {}, 0
    for start, count, body in hunks:
        at = start if count == 0 else start - 1       # `-5,0` means "after line 5"
        new += old[pos:at]
        pos = at
        for line in body:
            if line[0] == "+":
                new.append(line[1:])
                added[len(new)] = line[1:]
            else:
                pos += 1
                if line[0] == " ":
                    new.append(line[1:])
    return PatchedFile(new + old[pos:], added)


def patched_files(task: Task, clone: Path) -> dict[str, PatchedFile]:
    out = {}
    for path, hunks in parse_hunks(task.test_patch).items():
        spec = f"{task.base_commit}:{path}"
        base = gitutil.git(clone, "show", spec) if gitutil.git_ok(clone, "cat-file", "-e", spec) else ""
        out[path] = apply_hunks(base, hunks)
    return out


def _span(node) -> tuple[int, int]:
    first = min([d.lineno for d in getattr(node, "decorator_list", [])] + [node.lineno])
    return first, node.end_lineno


def _test_spans(tree: ast.Module) -> list[tuple[int, int]]:
    return [_span(n) for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name.startswith("test")]


def _find(tree: ast.Module, names: list[str]):
    node = tree
    for name in names:
        node = next((c for c in node.body if getattr(c, "name", None) == name), None)
        if node is None:
            return None
    return node


def lines_for_test(test_id: str, files: dict[str, PatchedFile]) -> tuple[list[str], str]:
    """The lines to show for one F2P test, and where they came from: `test` (added inside that
    test), `shared` (it gained none itself: lines added to fixtures, or to helpers in its file,
    outside any test), `none`."""
    path, *names = test_id.split("::")
    f = files.get(path)
    tree = ast.parse("\n".join(f.lines)) if f and path.endswith(".py") else None
    node = _find(tree, names) if tree else None
    if node is not None:
        lo, hi = _span(node)
        own = [text for no, text in sorted(f.added.items()) if lo <= no <= hi]
        if own:
            return own, "test"
    shared = []
    if tree:
        spans = _test_spans(tree)
        shared += [text for no, text in sorted(f.added.items()) if not any(a <= no <= b for a, b in spans)]
    for other, pf in files.items():
        if not other.endswith(".py"):
            shared += list(pf.added.values())
    return (shared, "shared") if shared else ([], "none")


def build_messages(issue: str, lines: list[str]) -> tuple[list[dict], bool]:
    """The whole prompt: the issue and the added lines. Nothing else may go in here."""
    text = "\n".join(lines)
    cut = len(text) > MAX_LINES_CHARS
    if cut:
        text = text[:MAX_LINES_CHARS] + "\n[... cut ...]"
    user = f"<issue>\n{issue.strip()}\n</issue>\n\n<added_test_lines>\n{text}\n</added_test_lines>\n\n{QUESTION}\n{FORMAT}"
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}], cut


def parse_verdict(text: str) -> tuple[str, str] | None:
    m = re.search(r"\{.*\}", text or "", re.S)
    try:
        d = json.loads(m.group(0)) if m else None
    except ValueError:
        return None
    verdict = str((d or {}).get("verdict", "")).strip().lower()
    return (verdict, str(d.get("reason", "")).strip()) if verdict in ("yes", "no", "partly") else None


def collect(tasks: dict[str, Task], lists: dict[str, list[str]], clone: Path) -> list[dict]:
    """One item per (task, F2P test): what will be asked. No model calls."""
    items = []
    for name, ids in lists.items():
        for tid in ids:
            t = tasks[tid]
            gitutil.ensure_commit(clone, t.base_commit)
            files = patched_files(t, clone)
            for test in t.fail_to_pass:
                lines, source = lines_for_test(test, files)
                messages, cut = build_messages(t.problem_statement, lines) if lines else ([], False)
                items.append({"list": name, "task": tid, "test": test, "source": source, "lines": lines,
                              "messages": messages, "cut": cut})
    return items


def estimate_usd(items: list[dict]) -> float:
    chars = sum(len(m["content"]) for it in items for m in it["messages"])
    calls = sum(bool(it["messages"]) for it in items)
    return chars / CHARS_PER_TOKEN * USD_PER_M_INPUT / 1e6 + calls * EST_OUTPUT_TOKENS * USD_PER_M_OUTPUT / 1e6


def item_path(out: Path, it: dict) -> Path:
    tag = hashlib.sha256(it["test"].encode()).hexdigest()[:8]
    return out / it["task"] / f"{it['test'].split('::')[-1]}-{tag}.json"


def judge(it: dict, out: Path, call) -> dict:
    """One saved record, reused if already there (a stopped screen resumes without paying twice).
    Raises if the model gives no usable verdict: the screen must not guess."""
    p = item_path(out, it)
    if p.exists():
        return json.loads(p.read_text())
    rec = {k: it[k] for k in ("list", "task", "test", "source", "lines", "cut")}
    rec.update(model=gen.MODEL, called_at=datetime.now(timezone.utc).isoformat(), messages=it["messages"])
    if not it["messages"]:
        rec.update(verdict="unjudged", reason="no added lines to show", response=None)
    else:
        parsed = None
        for max_tokens in (MAX_TOKENS, 2 * MAX_TOKENS):  # most often the reasoning used up the tokens
            resp = call(it["messages"], max_tokens=max_tokens)
            parsed = parse_verdict(resp["choices"][0]["message"].get("content"))
            if parsed:
                break
        if not parsed:
            raise RuntimeError(f"no verdict for {it['task']} {it['test']}: {json.dumps(resp)[:300]}")
        rec.update(verdict=parsed[0], reason=parsed[1], response=resp)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(rec, indent=2))
    return rec


def run(items: list[dict], out: Path, call=gen.call_model, workers: int = 8) -> list[dict]:
    def one(it: dict) -> dict:
        try:
            return judge(it, out, call)
        except Exception as e:  # the rest still finish and are saved, so a re-run pays only for these
            return {"task": it["task"], "test": it["test"], "failed": str(e)[:300]}

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        return list(pool.map(one, items))


def apply_rule(judgements: list[dict]) -> dict[str, dict]:
    """{task id: {"list", "keep", "exclude", "dropped"}}."""
    tasks: dict[str, dict] = {}
    for j in judgements:
        t = tasks.setdefault(j["task"], {"list": j["list"], "keep": [], "exclude": [], "dropped": False})
        t["exclude" if j["verdict"] == "no" else "keep"].append(j["test"])
    for t in tasks.values():
        t["dropped"] = not t["keep"]
    return tasks


def save(judgements: list[dict], out: Path) -> Path:
    path = out / "screened.json"
    path.write_text(json.dumps({"rule": RULE, "model": gen.MODEL, "tasks": apply_rule(judgements),
                                "judgements": [{k: j[k] for k in ("list", "task", "test", "source", "verdict", "reason")}
                                               for j in judgements]}, indent=2))
    return path


def load(path: Path) -> dict:
    return json.loads(Path(path).read_text())


def sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def resolved(grade: dict, excluded) -> bool:
    """Resolved under the screened lists, from the per-test results of a full grade. Anything that
    could not be graded stays unresolved, as does a task with no F2P test left."""
    if not grade or grade.get("error") or not grade.get("test_patch_applied", True):
        return False
    excluded = set(excluded)
    kept = [t for t in grade.get("f2p_passed", []) + grade.get("f2p_failed", []) if t not in excluded]
    return bool(kept) and not (set(grade.get("f2p_failed", [])) - excluded) and not grade.get("p2p_failed")


def summary(screened: dict) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for tid, t in screened["tasks"].items():
        s = out.setdefault(t["list"], {"tasks": 0, "kept": 0, "dropped": 0, "tests": 0, "excluded": 0, "dropped_ids": []})
        s["tasks"] += 1
        s["tests"] += len(t["keep"]) + len(t["exclude"])
        s["excluded"] += len(t["exclude"])
        s["kept"] += not t["dropped"]
        s["dropped"] += t["dropped"]
        s["dropped_ids"] += [tid] if t["dropped"] else []
    return out


def sample(screened: dict, n: int, seed: int) -> list[dict]:
    """n random judgements each of yes and no, for checking by hand."""
    rng = random.Random(seed)
    out = []
    for verdict in ("yes", "no"):
        pool = [j for j in screened["judgements"] if j["verdict"] == verdict]
        out += rng.sample(pool, min(n, len(pool)))
    return out


def paired(rows: dict[tuple[str, int], dict[str, bool]], arms: list[str], base: str = "none") -> dict[str, dict]:
    """Per arm: {"resolved", "wins", "losses", "tasks"} against `base` on the same (task, seed)."""
    out = {}
    for arm in arms:
        pairs = [(r[arm], r[base]) for r in rows.values() if arm in r and base in r]
        out[arm] = {"resolved": sum(r[arm] for r in rows.values() if arm in r), "tasks": len(pairs),
                    "wins": sum(a and not b for a, b in pairs), "losses": sum(b and not a for a, b in pairs)}
    return out
