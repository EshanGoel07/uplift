"""Why did failed runs fail? Simple rules first, then one Muse Spark label per failed run.

Muse Spark sees the issue, the real fix's file list and the agent's diff, nothing else: no arm, no
test results, no rule output. So agreement with the rules is a real cross-check, and two labels are
hard for it by design: "broke other tests" and "ran out of steps" depend on facts it isn't given.

Rules come from saved results and the web audit, so they are free. Every prompt and response is
saved under .uplift/<repo>/labels/, and a saved label is reused, so a stopped run resumes without
paying twice.
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from . import analysis, generate as gen

LABELS = ("wrong file", "incomplete fix", "wrong approach", "broke other tests", "ran out of steps", "other")
RULES = {"edited_no_fix_file": "wrong file", "broke_p2p": "broke other tests", "step_limit": "ran out of steps",
         "never_ran_tests": None}
RULE_NAMES = {"edited_no_fix_file": "Edited none of the fix's files", "broke_p2p": "Broke PASS_TO_PASS tests",
              "never_ran_tests": "Never ran tests", "step_limit": "Hit the step limit"}
MAX_DIFF_CHARS = 12_000
MAX_TOKENS = 8000            # Muse Spark's hidden reasoning counts against this
# Estimate only (the proxy meters the real cost). USD per 1M tokens for muse-spark-1.3-contributor.
USD_PER_M_INPUT, USD_PER_M_OUTPUT = 0.10, 0.20
EST_OUTPUT_TOKENS, CHARS_PER_TOKEN = 3000, 3.0

SYSTEM = ("You review failed bug-fix attempts by an AI coding agent. The attempt below failed the repository's "
          "tests. Judge only from what you are given.")
QUESTION = f"""Why did this attempt most likely fail? Choose exactly one label:
- wrong file: the agent changed the wrong part of the code base
- incomplete fix: right area and idea, but some required case or dialect is missing
- wrong approach: the change would not solve the issue as described
- broke other tests: the change would break existing behaviour
- ran out of steps: the work looks unfinished, cut off part way
- other: none of these fits, or there is too little to tell

Return one JSON object, no prose around it: {{"label": one of {json.dumps(list(LABELS))}, "reason": "<one line>"}}"""
_FILE = re.compile(r"^diff --git a/\S+ b/(\S+)$", re.M)


def changed_files(diff: str) -> list[str]:
    return _FILE.findall(diff)


def rules(result: dict, diff: str, fix_files: list[str], ran_tests: bool) -> dict[str, bool]:
    g = result.get("grade") or {}
    return {"edited_no_fix_file": not set(changed_files(diff)) & set(fix_files),
            "broke_p2p": bool(g.get("p2p_failed")),
            "never_ran_tests": not ran_tests,
            "step_limit": "step(s)" in (result.get("agent_end") or "")}


def build_messages(issue: str, fix_files: list[str], diff: str) -> tuple[list[dict], bool]:
    """The whole prompt. No arm, no test results, no rule output may go in here."""
    cut = len(diff) > MAX_DIFF_CHARS
    shown = diff[:MAX_DIFF_CHARS] + "\n[... cut ...]" if cut else (diff or "(the agent changed nothing)")
    user = (f"<issue>\n{issue.strip()}\n</issue>\n\n<real_fix_files>\n" + "\n".join(fix_files) +
            f"\n</real_fix_files>\n\n<agent_diff>\n{shown}\n</agent_diff>\n\n{QUESTION}")
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}], cut


def parse_label(text: str | None) -> tuple[str, str] | None:
    m = re.search(r"\{.*\}", text or "", re.S)
    try:
        d = json.loads(m.group(0)) if m else None
    except ValueError:
        return None
    label = str((d or {}).get("label", "")).strip().lower()
    return (label, str(d.get("reason", "")).strip()) if label in LABELS else None


def item_path(out: Path, it: dict) -> Path:
    return out / it["arm"] / f"{it['task']}-s{it['seed']}.json"


def collect(batch: analysis.Batch, tasks: dict, audit: dict[tuple, dict]) -> list[dict]:
    """One item per failed run, with its rule results and its prompt. No model calls."""
    items = []
    for key in sorted(batch.results, key=str):
        res = batch.results[key]
        if res["resolved"]:
            continue
        task, arm, seed = key
        t = tasks[task]
        diff = (batch.dirs[key] / "agent.patch").read_bytes().decode("utf-8", "replace")
        messages, cut = build_messages(t.problem_statement, t.fix_files, diff)
        items.append({"task": task, "arm": arm, "seed": seed, "cut": cut, "messages": messages,
                      "rules": rules(res, diff, t.fix_files, audit[key]["ran_tests"])})
    return items


def estimate_usd(items: list[dict]) -> float:
    chars = sum(len(m["content"]) for it in items for m in it["messages"])
    return chars / CHARS_PER_TOKEN * USD_PER_M_INPUT / 1e6 + len(items) * EST_OUTPUT_TOKENS * USD_PER_M_OUTPUT / 1e6


def judge(it: dict, out: Path, call) -> dict:
    """One saved record, reused if there. Raises if no usable label comes back: never guess."""
    p = item_path(out, it)
    if p.exists():
        return json.loads(p.read_text())
    parsed = resp = None
    for max_tokens in (MAX_TOKENS, 2 * MAX_TOKENS, 4 * MAX_TOKENS):  # most often the reasoning used up the tokens
        resp = call(it["messages"], max_tokens=max_tokens)
        parsed = parse_label(resp["choices"][0]["message"].get("content"))
        if parsed:
            break
    if not parsed:
        raise RuntimeError(f"no label for {it['task']} {it['arm']} s{it['seed']}: {json.dumps(resp)[:300]}")
    rec = dict(it, model=gen.MODEL, called_at=datetime.now(timezone.utc).isoformat(), label=parsed[0],
               reason=parsed[1], response=resp)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(rec, indent=2))
    return rec


def run(items: list[dict], out: Path, call=gen.call_model, workers: int = 8) -> list[dict]:
    def one(it: dict) -> dict:
        try:
            return judge(it, out, call)
        except Exception as e:  # the rest still finish and are saved, so a re-run pays only for these
            return {"task": it["task"], "arm": it["arm"], "seed": it["seed"], "failed": str(e)[:300]}

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        return list(pool.map(one, items))


def saved(d: Path) -> list[dict]:
    root = d / "labels"
    return [json.loads(p.read_text()) for p in sorted(root.glob("*/*.json"))] if root.is_dir() else []


def agreement(records: list[dict]) -> list[dict]:
    """For each rule with a matching label: runs where both, only the rule, only Muse Spark said so."""
    out = []
    for rule, label in RULES.items():
        if label:
            both = sum(r["rules"][rule] and r["label"] == label for r in records)
            rule_only = sum(r["rules"][rule] and r["label"] != label for r in records)
            spark_only = sum(not r["rules"][rule] and r["label"] == label for r in records)
            out.append({"rule": rule, "label": label, "both": both, "rule_only": rule_only, "spark_only": spark_only,
                        "neither": len(records) - both - rule_only - spark_only})
    return out


def report_section(d: Path, batch: analysis.Batch) -> list[str]:
    from .report import table
    records = saved(d)
    records = [r for r in records if (r["task"], r["arm"], r["seed"]) in batch.results]
    if not records:
        return []
    failed = {a: sum(not r["resolved"] for (_, arm, _), r in batch.results.items() if arm == a) for a in batch.arms}
    named = lambda a: analysis.ARM_LABELS.get(a, a)   # noqa: E731
    total = sum(failed.values())
    md = ["## Why runs failed", "",
          f"{len(records)} of {total} failed runs have a label. Rules are checked facts and a run can match several. Muse Spark gives one "
          "label, from the issue, the real fix's file list and the agent's diff only.", "", "**Rules, runs per arm**", ""]
    md += table(["Arm", "Failed", *RULE_NAMES.values()],
                [[named(a), failed[a], *(sum(r["rules"][k] for r in records if r["arm"] == a) for k in RULE_NAMES)]
                 for a in batch.arms])
    md += ["", "**Muse Spark labels, runs per arm**", ""]
    md += table(["Arm", *[x.capitalize() for x in LABELS]],
                [[named(a), *(sum(r["label"] == x for r in records if r["arm"] == a) for x in LABELS)] for a in batch.arms])
    md += ["", "**Agreement with the rules**", ""]
    md += table(["Rule", "Label", "Both", "Rule only", "Muse Spark only", "Neither"],
                [[RULE_NAMES[x["rule"]], x["label"], x["both"], x["rule_only"], x["spark_only"], x["neither"]]
                 for x in agreement(records)])
    broke = next(x for x in agreement(records) if x["rule"] == "broke_p2p")
    md += ["", "Muse Spark sees no test results or step count, so the last two rows test it on what it had to guess. "
           f"Its \"broke other tests\" label is not reliable: {broke['spark_only']} of its {broke['both'] + broke['spark_only']} "
           "uses are on runs where every PASS_TO_PASS test passed. Its reasons often cite files in the real fix that the "
           "agent left alone, so \"incomplete fix\" may be over-counted too. Treat the labels as a rough view of the "
           "failures and the rules as the facts. \"Never ran tests\" has no matching label."]
    return md
