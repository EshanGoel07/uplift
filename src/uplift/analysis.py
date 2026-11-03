"""Results of a finished batch: load the runs, compare arms, write site/data/results.json.

Free and offline: everything comes from files on disk. `load` refuses a batch with a missing run or
a `resolved` that the screened grading rule does not reproduce, so no number here rests on a partial
or inconsistent batch. Same inputs, same numbers: the bootstrap has a fixed seed.

All rates and differences are fractions (0.727, not 72.7).
"""

from __future__ import annotations

import csv
import gzip
import json
import random
import re
from dataclasses import dataclass, field
from pathlib import Path

from . import batch as batch_mod, screen

ARM_LABELS = {"none": "No setup", "prose": "Tips file (generated)", "sensors": "Hooks (generated)",
              "both": "Tips + hooks", "handwritten": "Generic tips file", "tuned": "Tuned by Muse Spark"}
ARM_DESCRIPTIONS = {
    "none": "No setup files: the agent sees only the issue and the code.",
    "prose": "An AGENTS.md tips file for this repo, written by Muse Spark from history before the test period.",
    "sensors": "Hooks generated for this repo: lint after edits, co-change warnings, and a test check before stopping.",
    "both": "The generated tips file and the generated hooks together.",
    "handwritten": "A generic best-practice file, written by us in the style commonly shared online.",
    "tuned": "Tips and hooks revised by Muse Spark from failures on dev tasks only.",
}
AGENT = "Muse Code (muse-spark-1.3-contributor)"
BOOTSTRAP_N = 10_000
BOOTSTRAP_SEED = 20261101
Z_95, Z_80_POWER = 1.96, 0.8416
MAX_DIFF_CHARS = 30_000     # site/data/results.json has to stay small enough to load in a browser
BASE = "none"
LEDGER = Path(__file__).resolve().parents[2] / "tools" / "budget_guard" / "meta" / "budget_log.csv"

MARKER = "Uplift checks:"    # how uplift_hook.py opens every message to the agent


@dataclass
class Batch:
    tasks: list[str]                    # test tasks first, then fresh, each sorted
    arms: list[str]
    seeds: list[int]
    sets: dict[str, str]                # task -> test | fresh
    results: dict[tuple, dict]          # (task, arm, seed) -> result.json
    dirs: dict[tuple, Path] = field(default_factory=dict)

    def solved(self, task: str, arm: str) -> int:
        return sum(bool(self.results[(task, arm, s)]["resolved"]) for s in self.seeds)


def load(d: Path, plan: dict, split_sets: dict[str, list[str]]) -> Batch:
    """`d` is .uplift/<repo>. `split_sets` is {"test": ids, "fresh": ids}."""
    if screen.sha256(plan["screen"]["path"]) != plan["screen"]["sha256"]:
        raise SystemExit("screened.json changed since this plan was written; results would not match")
    excluded = {tid: t["exclude"] for tid, t in screen.load(plan["screen"]["path"])["tasks"].items()}
    sets = {tid: name for name, ids in split_sets.items() for tid in ids}
    planned = list(dict.fromkeys(r["task"] for r in plan["runs"]))
    outside = [t for t in planned if t not in sets]
    if outside:
        raise SystemExit(f"task(s) in neither set: {outside[:5]}")
    results, dirs = {}, {}
    for r in plan["runs"]:
        run_dir = batch_mod.run_path(d / "runs", r)
        res = batch_mod.read_result(run_dir)
        if res is None:
            raise SystemExit(f"no result for {r}")
        if bool(res["resolved"]) != screen.resolved(res.get("grade"), excluded.get(r["task"], [])):
            raise SystemExit(f"resolved does not match the screened grade for {r}")
        key = (r["task"], r["arm"], r["seed"])
        results[key], dirs[key] = res, run_dir
    order = {"test": 0, "fresh": 1}
    return Batch(sorted(planned, key=lambda t: (order[sets[t]], t)), list(dict.fromkeys(r["arm"] for r in plan["runs"])),
                 sorted({r["seed"] for r in plan["runs"]}), {t: sets[t] for t in planned}, results, dirs)


def ledger_cost(batch: Batch, ledger: Path = LEDGER) -> float:
    """The proxy's settled cost of these runs. Each agent run has a row naming its run folder; a
    folder can have more than one (a smoke run wrote to the same path before the batch), and the
    batch's run is then the last. Runs with no row are an error, so a gap can't pass as cheap."""
    last: dict[str, float] = {}
    with ledger.open(newline="") as f:
        for row in csv.DictReader(f):
            if row["model"].startswith("external:muse "):
                last[row["model"].split(" ", 1)[1]] = float(row["cost_usd"])
    wanted = [str(p.resolve()) for p in batch.dirs.values()]
    missing = [w for w in wanted if w not in last]
    if missing:
        raise SystemExit(f"{len(missing)} run(s) missing from the ledger, e.g. {missing[0]}")
    return sum(last[w] for w in wanted)


def run_cost(batch: Batch, arm: str | None = None) -> float:
    return sum(r.get("cost_usd") or 0.0 for (_, a, _), r in batch.results.items() if arm in (None, a))


def per_task(batch: Batch, tasks: list[str] | None = None) -> dict[str, list[float]]:
    """{arm: [share of this arm's runs solved, per task]}."""
    tasks = tasks if tasks is not None else batch.tasks
    return {a: [batch.solved(t, a) / len(batch.seeds) for t in tasks] for a in batch.arms}


def percentile_ci(values: list[float]) -> tuple[float, float]:
    s, n = sorted(values), len(values)
    return s[int(0.025 * n)], s[min(n - 1, int(0.975 * n))]


def sd(values: list[float]) -> float:
    m = sum(values) / len(values)
    return (sum((v - m) ** 2 for v in values) / (len(values) - 1)) ** 0.5


def bootstrap(matrix: dict[str, list[float]], base: str = BASE, n: int = BOOTSTRAP_N,
              seed: int = BOOTSTRAP_SEED) -> dict[str, dict]:
    """Resample tasks with replacement, the same tasks for every arm, so differences stay paired.
    Runs of one task are not independent, so the task is the unit. Percentile intervals.
    {arm: {"rate": mean, "rate_ci": (lo, hi), "diff": mean - base, "diff_ci": (lo, hi), "diff_se": sd}}."""
    arms = list(matrix)
    size = len(matrix[arms[0]])
    rng = random.Random(seed)
    rates: dict[str, list[float]] = {a: [] for a in arms}
    diffs: dict[str, list[float]] = {a: [] for a in arms}
    for _ in range(n):
        idx = rng.choices(range(size), k=size)
        means = {a: sum(matrix[a][i] for i in idx) / size for a in arms}
        for a in arms:
            rates[a].append(means[a])
            diffs[a].append(means[a] - means[base])
    out = {}
    for a in arms:
        rate = sum(matrix[a]) / size
        out[a] = {"rate": rate, "rate_ci": percentile_ci(rates[a]), "diff": rate - sum(matrix[base]) / size,
                  "diff_ci": percentile_ci(diffs[a]), "diff_se": sd(diffs[a])}
    return out


def arm_rows(batch: Batch) -> list[dict]:
    stats = bootstrap(per_task(batch))
    rows = []
    for a in batch.arms:
        runs = [r for (_, arm, _), r in batch.results.items() if arm == a]
        solved = sum(bool(r["resolved"]) for r in runs)
        s = stats[a]
        rows.append({"id": a, "label": ARM_LABELS.get(a, a), "description": ARM_DESCRIPTIONS.get(a, ""), "solved": solved, "attempts": len(runs),
                     "rate": round(solved / len(runs), 5), "diff_vs_none": round(s["diff"], 5),
                     "ci_low": round(s["diff_ci"][0], 5), "ci_high": round(s["diff_ci"][1], 5),
                     "cost_per_solved": round(run_cost(batch, a) / solved, 4) if solved else None,
                     "regressions": sum(bool((r.get("grade") or {}).get("p2p_failed")) for r in runs)})
    return rows


def read_trace(run_dir: Path) -> str:
    p = Path(run_dir) / "stderr_trace.log.gz"
    if not p.exists():
        return ""
    with gzip.open(p, "rt", errors="replace") as f:
        return f.read()


def fired_records(run_dir: Path) -> list[dict]:
    """Hook evaluations that produced a message. The log also has one line per quiet evaluation,
    and a not-fired line's detail (`ran: tests...`, file names) was never shown to the agent."""
    log = Path(run_dir) / "hooks.jsonl"
    if not log.exists():
        return []
    out = []
    for line in log.read_text(errors="replace").splitlines():
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if rec.get("fired"):
            out.append(rec)
    return out


def sent_messages(run_dir: Path) -> tuple[list[str], list[dict]]:
    """(messages that reached the model, fired records that did not).

    hooks.jsonl says what a hook wanted to send, cut at 2,000 characters. The model's requests say
    what arrived, in full. A Stop block on the last step fires and is logged, but the run ends at the
    step limit before another request is made, so the agent never sees it."""
    fired = fired_records(run_dir)
    if not fired:
        return [], []
    sent: list[str] = []
    for line in read_trace(run_dir).split("\n"):
        if line.startswith("REQUEST:") and MARKER in line:
            # Every request repeats the conversation. Only developer messages count: Muse's reminder
            # side-calls quote the whole transcript inside a user message.
            for item in json.loads(line[len("REQUEST:"):]).get("input", []):
                text = item.get("content") if item.get("role") == "developer" else None
                if isinstance(text, str) and MARKER in text:
                    # After a Stop block, Muse appends its own reminders to the same message.
                    text = text[text.index(MARKER):].split("\n\n<system-reminder", 1)[0]
                    if text not in sent:
                        sent.append(text)
    blob = "\n".join(sent)
    lost = [r for r in fired if r["detail"].split("\n")[0].strip()[:120] not in blob]
    return sent, lost


def cut_diff(diff: str, limit: int = MAX_DIFF_CHARS) -> str:
    if len(diff) <= limit:
        return diff
    return diff[:limit] + f"\n[... diff truncated for the site: {len(diff) - limit:,} more characters ...]\n"


def scrub(text: str, workspaces: Path) -> str:
    """Absolute workspace paths in pytest output say nothing about the run, and name the build machine."""
    text = re.sub(re.escape(str(workspaces)) + r"/[^/\s]+/[^/\s]+", "<workspace>", text)
    return text.replace(str(Path.home()), "~")


def first_line(issue: str) -> str:
    return next((ln.strip() for ln in issue.splitlines() if ln.strip()), "")


def trust_cards(ledger_usd: float, runs: int, web: dict) -> list[dict]:
    outcome = ("One arm's interval excludes zero on those tasks." if web["clean_clear"]
               else "No arm differs clearly from no setup on those tasks either.")
    return [
        {"title": "Snapshot leak checks",
         "detail": "0 of 40 test-set fixes and 0 of 40 fresh fixes are in the snapshots the setups learned from. "
                   "The check does fire when it should: as positive controls it finds 24 of 40 dev fixes and "
                   "30 of 40 fresh fixes at HEAD."},
        {"title": "Fresh 2026 bugs",
         "detail": "Half the tasks are bugs fixed in sqlglot between April and October 2026, mined directly from "
                   "the repo. The agent sees only the linked GitHub issue."},
        {"title": "Dev and test kept apart",
         "detail": "Setups were tuned on dev tasks only, and the code refuses any test or fresh task in the tuning "
                   "inputs. Test and fresh tasks were used for this final report."},
        {"title": "A grader that fails closed",
         "detail": "Only the repo's real tests decide a result, with test files reset first. Parsed results must "
                   "match pytest's own summary, or the run can't pass. This caught 3 hidden-failure formats."},
        {"title": "Clean workspaces, one gap found and measured",
         "detail": "Each run starts from one snapshot with no git history and without the repo's own CLAUDE.md and "
                   "AGENTS.md, but the agent could still reach the web. Our audit of every tool call found "
                   f"{web['exposed']} of {runs} runs that reached the real fix or newer code, evenly across arms "
                   f"({web['lo']}-{web['hi']} per arm). Dropping every affected task leaves {web['clean_tasks']} tasks. "
                   + outcome},
        {"title": "Every run metered",
         "detail": f"All {runs} runs went through a hard-capped proxy that allows only Meta models. Its ledger "
                   f"total, ${ledger_usd:.2f}, matches the sum of the runs' recorded costs."},
    ]


def export(batch: Batch, tasks: dict, repo: str, workspaces: Path, web: dict, ledger: Path = LEDGER) -> tuple[dict, dict]:
    """(results.json content, notes for the caller). `tasks` is {id: Task}."""
    total = ledger_cost(batch, ledger)
    if abs(total - run_cost(batch)) > 0.01:
        raise SystemExit(f"ledger ${total:.6f} does not match the runs' costs ${run_cost(batch):.6f}")
    notes = {"not_delivered": [], "diffs_cut": 0, "with_messages": 0}
    out_tasks = []
    for tid in batch.tasks:
        issue = tasks[tid].problem_statement.strip()
        entry = {"id": tid, "set": batch.sets[tid], "title": first_line(issue), "issue": issue, "results": {}}
        for arm in batch.arms:
            runs = []
            for seed in batch.seeds:
                key = (tid, arm, seed)
                res, run_dir = batch.results[key], batch.dirs[key]
                diff = (run_dir / "agent.patch").read_bytes().decode("utf-8", "replace")
                cut = cut_diff(diff)
                notes["diffs_cut"] += cut != diff
                sent, lost = sent_messages(run_dir)
                notes["with_messages"] += bool(sent)
                notes["not_delivered"] += [{"task": tid, "arm": arm, "seed": seed, "check": r["check"]} for r in lost]
                runs.append({"seed": seed, "resolved": bool(res["resolved"]), "cost_usd": res.get("cost_usd"),
                             "diff": scrub(cut, workspaces), "hooks": [scrub(m, workspaces) for m in sent]})
            entry["results"][arm] = {"solved": batch.solved(tid, arm), "runs": runs}
        out_tasks.append(entry)
    return {"summary": {"runs": len(batch.results), "tasks": len(batch.tasks), "total_cost_usd": round(total, 2),
                        "agent": AGENT, "repo": repo},
            "arms": arm_rows(batch), "tasks": out_tasks,
            "trust": trust_cards(total, len(batch.results), web)}, notes
