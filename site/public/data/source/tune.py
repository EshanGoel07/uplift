"""Tuned arm: Muse Spark reads what happened on dev and rewrites the setup. It writes an AGENTS.md
(at most 30 lines) and chooses which hooks to keep and their wording; Uplift renders the hooks as
for the other arms, so their format is always valid and co-change rules stay data-backed.

Dev only (the point of the split): the inputs are the generated setup, screened dev results per
arm, hook messages and short failure summaries for tasks where arms differed, and written findings.
`assert_dev_only` refuses anything else. Every input and output is saved under
.uplift/<repo>/tune/<run id>/.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from . import batch, generate as gen, screen

SYSTEM = """You improve the setup of an AI coding agent that fixes bugs in one repository.
You are given the current setup and how it did on a set of past bugs, by arm (which parts of the
setup were switched on). Each arm ran once per task, so small differences are noise.
Write rules that will hold for future bugs in this repository. Never mention a specific past task."""

INSTRUCTIONS = """Diagnose what helped and what did not, then return ONE JSON object, no prose around it:

"agents_md": the new AGENTS.md text, at most 30 lines.
"hooks": {
  "lint": {"keep": true or false, "note": one sentence added after lint findings, or ""},
  "verify": {"keep": true or false, "note": one sentence that tells the agent what to do when related tests fail, or ""},
  "cochange": {"keep": true or false,
               "rules": [{"if_edited": path, "expect_also": path, "message": one sentence}]}
}
  Hooks: lint runs after edits, cochange warns after edits, verify runs tests when the agent tries to finish
  and can block it once or twice. "rules" may only use (if_edited, expect_also) pairs from the current setup.
"why": at most five lines: what the results showed and why you chose this.
"""


def assert_dev_only(inputs: dict, holdout_ids: list[str]) -> None:
    """No test or fresh task may reach the model, by id or as a fresh-style name."""
    text = json.dumps(inputs)
    bad = [i for i in holdout_ids if i in text or ("-fresh-" in i and i.rsplit("-", 1)[-1] in text)]
    if bad:
        raise ValueError(f"holdout task(s) in the tuning inputs: {bad[:5]}")


def _reason(run_dir: Path, test: str) -> str:
    log = run_dir / "grade_pytest.txt"
    if log.exists():
        for line in log.read_text(errors="replace").splitlines():
            if line.startswith("FAILED " + test):
                return line.split(" - ", 1)[-1][:160]
    return ""


def _hook_messages(run_dir: Path) -> list[str]:
    log = run_dir / "hooks.jsonl"
    out: list[str] = []
    for line in log.read_text().splitlines() if log.exists() else []:
        rec = json.loads(line)
        if rec.get("fired") and rec["detail"][:300] not in out:
            out.append(rec["detail"][:300])
    return out


def run_summary(run_dir: Path, res: dict, excluded: list[str]) -> dict:
    """One failed run: kept tests that failed and why, regressions, files changed, hooks that fired."""
    g = res.get("grade") or {}
    failed = [t for t in g.get("f2p_failed", []) if t not in excluded]
    patch = run_dir / "agent.patch"
    return {"failed_tests": [{"test": t.split("::")[-1], "reason": _reason(run_dir, t)} for t in failed],
            "regressions": [t.split("::")[-1] for t in g.get("p2p_failed", [])],
            "files_changed": re.findall(r"^diff --git a/\S+ b/(\S+)$", patch.read_text() if patch.exists() else "", re.M),
            "ran_out_of_steps": "step(s)" in (res.get("agent_end") or ""),
            "hook_messages": _hook_messages(run_dir)}


def collect_inputs(d: Path, plan: dict, spec: dict, screened: dict, table: dict, findings: str,
                   dev_ids: list[str], holdout_ids: list[str]) -> dict:
    outside = sorted({r["task"] for r in plan["runs"]} - set(dev_ids))
    if outside:
        raise ValueError(f"the plan has non-dev tasks: {outside[:5]}")
    by_task: dict[str, dict] = {}
    for r in plan["runs"]:
        t = screened["tasks"][r["task"]]
        if not t["dropped"]:
            res = batch.read_result(batch.run_path(d / "runs", r))
            by_task.setdefault(r["task"], {})[r["arm"]] = (r, res, t)
    differed = {}
    for tid, arms in by_task.items():
        solved = {a: screen.resolved(res["grade"], t["exclude"]) for a, (_, res, t) in arms.items()}
        if len(set(solved.values())) == 2:
            differed[tid] = {"solved_by": sorted(a for a, s in solved.items() if s),
                             "failed_runs": {a: run_summary(batch.run_path(d / "runs", arms[a][0]), arms[a][1],
                                                            arms[a][2]["exclude"])
                                             for a, s in solved.items() if not s}}
    inputs = {"current_setup": {k: spec[k] for k in ("agents_md", "lint", "cochange")},
              "arms": {a: {"agents_md": with_md, "hooks": checks} for a, (with_md, checks) in gen.ARMS.items()}
              | {"handwritten": {"agents_md": "generic, not repo-specific", "hooks": []}},
              "results_per_arm_vs_none": table["screened"],
              "tasks_where_arms_differed": differed,
              "findings": findings}
    assert_dev_only(inputs, holdout_ids)
    return inputs


def build_messages(inputs: dict) -> list[dict]:
    return [{"role": "system", "content": SYSTEM},
            {"role": "user", "content": INSTRUCTIONS + "\n\nINPUTS (JSON):\n" + json.dumps(inputs)}]


def parse(text: str, spec: dict) -> tuple[dict, list[str], list[str]]:
    """(renderable spec, checks to enable, problems). Problems make the output unusable."""
    m = re.search(r"\{.*\}", text or "", re.S)
    try:
        out = json.loads(m.group(0)) if m else None
    except ValueError as e:
        return {}, [], [f"invalid JSON: {e}"]
    if not isinstance(out, dict):
        return {}, [], ["no JSON object in the response"]
    problems = []
    agents = (out.get("agents_md") or "").strip()
    if not agents:
        problems.append("agents_md is empty")
    elif len(agents.splitlines()) > gen.MAX_AGENTS_LINES:
        problems.append(f"agents_md has {len(agents.splitlines())} lines (max {gen.MAX_AGENTS_LINES})")
    hooks = out.get("hooks") or {}
    keep = {c: bool((hooks.get(c) or {}).get("keep")) for c in ("lint", "cochange", "verify")}
    known = {(r["if_edited"], r["expect_also"]) for r in spec["cochange"]}
    wanted = (hooks.get("cochange") or {}).get("rules") or []
    rules = [r for r in wanted if isinstance(r, dict) and (r.get("if_edited"), r.get("expect_also")) in known
             and isinstance(r.get("message"), str) and r["message"].strip()]
    if len(rules) != len(wanted):
        problems.append(f"{len(wanted) - len(rules)} co-change rule(s) not from the current setup")
    if keep["cochange"] and not rules:
        problems.append("cochange kept with no rules")
    tuned = dict(spec, agents_md=agents, cochange=rules if keep["cochange"] else [],
                 wording={c: str((hooks.get(c) or {}).get("note") or "").strip() for c in ("lint", "verify")},
                 why=out.get("why", ""))
    return tuned, [c for c in ("lint", "cochange", "verify") if keep[c]], problems


def render(tuned: dict, checks: list[str], risk: dict, arms_root: Path, *, feedback: str, run_id: str) -> list[str]:
    return gen.render_arms(tuned, risk, arms_root, feedback=feedback, generator_run=run_id,
                           arms={"tuned": (True, checks)})["tuned"]
