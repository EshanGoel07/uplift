"""`uplift report`: reports/main.md and PNG charts from a finished batch. Free and offline.

Deterministic: fixed bootstrap seed, no timestamps, no run-dependent metadata in the PNGs. Same inputs,
same bytes. matplotlib is imported only for the charts (`pip install -e .[report]`).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from . import analysis, batch as batch_mod, label, screen, webaudit

CHARTS = {"solved": "solved_per_arm.png", "diff": "difference_vs_none.png", "sets": "test_vs_fresh.png",
          "cost": "cost_per_solved.png"}
ABLATION_ROWS = ("none", "lint-only", "cochange-only", "verify-only")

# Validated with the dataviz skill's validate_palette.js (see PHASE_LOG.md).
SERIES = "#2a78d6"     # the arms
SECOND = "#eb6834"     # fresh tasks, in the one chart with two series
MUTED = "#8a8982"      # "No setup", the reference
INK, INK_2, GRID, SURFACE = "#0b0b0b", "#52514e", "#e6e5e0", "#fcfcfb"


def pct(x: float) -> str:
    return f"{x * 100:.1f}%"


def pts(x: float) -> str:
    return f"{x * 100:+.1f}"


def compute(b: analysis.Batch) -> dict:
    """Every number in the report."""
    matrix = analysis.per_task(b)
    stats = analysis.bootstrap(matrix)
    rows = {r["id"]: r for r in analysis.arm_rows(b)}
    out: dict = {"arms": [], "sets": {}}
    for a in b.arms:
        s = stats[a]
        wins = sum(x > y for x, y in zip(matrix[a], matrix[analysis.BASE]))
        losses = sum(x < y for x, y in zip(matrix[a], matrix[analysis.BASE]))
        runs = [r for (_, arm, _), r in b.results.items() if arm == a]
        out["arms"].append(dict(rows[a], rate_ci=s["rate_ci"], diff=s["diff"], diff_ci=s["diff_ci"], wins=wins, losses=losses,
                                half_width=(s["diff_ci"][1] - s["diff_ci"][0]) / 2,
                                mde=(analysis.Z_95 + analysis.Z_80_POWER) * s["diff_se"],
                                cost=analysis.run_cost(b, a),
                                step_limit=sum(r.get("agent_exit") not in (0, None) for r in runs)))
    for name in ("test", "fresh"):
        tasks = [t for t in b.tasks if b.sets[t] == name]
        out["sets"][name] = {"tasks": len(tasks), "arms": analysis.bootstrap(analysis.per_task(b, tasks))}
    full = 2 * len(b.arms) if len(b.seeds) == 2 else len(b.seeds) * len(b.arms)
    per_task_total = {t: sum(b.solved(t, a) for a in b.arms) for t in b.tasks}
    out["solved_by_all"] = sum(v == full for v in per_task_total.values())
    out["solved_by_none"] = sum(v == 0 for v in per_task_total.values())
    out["discriminating"] = len(b.tasks) - out["solved_by_all"] - out["solved_by_none"]
    out["repeats_disagree"] = sum(0 < b.solved(t, a) < len(b.seeds) for t in b.tasks for a in b.arms)
    out["task_arm_pairs"] = len(b.tasks) * len(b.arms)
    return out


def dev_rows(d: Path, dev_plan: dict, screened: dict) -> dict:
    """Solved and wins/losses vs none on the same (task, seed), screened dev tasks."""
    rows: dict = {}
    for r in dev_plan["runs"]:
        t = screened["tasks"].get(r["task"])
        res = batch_mod.read_result(batch_mod.run_path(d / "runs", r))
        if t and not t["dropped"] and res is not None:
            rows.setdefault((r["task"], r["seed"]), {})[r["arm"]] = screen.resolved(res.get("grade"), t["exclude"])
    return screen.paired(rows, list(dict.fromkeys(r["arm"] for r in dev_plan["runs"])))


def hook_delivery(b: analysis.Batch) -> dict:
    """{arm: {"runs_with_messages", "messages", "not_delivered"}} for arms with hooks."""
    out: dict = {}
    for (_, arm, _), run_dir in sorted(b.dirs.items(), key=lambda kv: str(kv[0])):
        sent, lost = analysis.sent_messages(run_dir)
        if sent or lost:
            a = out.setdefault(arm, {"runs_with_messages": 0, "messages": 0, "not_delivered": 0})
            a["runs_with_messages"] += bool(sent)
            a["messages"] += len(sent)
            a["not_delivered"] += len(lost)
    return out


def web_section(b: analysis.Batch, rows: list[dict], dev_rows_: list[dict]) -> list[str]:
    """The route round the leakage checks, and whether the result survives without it."""
    n = len(rows)
    exposed = [r for r in rows if r["tier"] in webaudit.EXPOSED]
    solved = lambda rs: sum(bool(b.results[(r["task"], r["arm"], r["seed"])]["resolved"]) for r in rs)   # noqa: E731
    clean = [r for r in rows if r["tier"] == 5]
    per_set = {name: [r for r in exposed if b.sets[r["task"]] == name] for name in ("test", "fresh")}
    set_runs = {name: sum(b.sets[r["task"]] == name for r in rows) for name in ("test", "fresh")}
    md = ["## Web access: a leak the snapshot checks could not see", "",
          "Workspaces have no git history, but Muse Code has web tools and its shell has network access, so an agent "
          "can look up the real fix upstream. Nothing blocked this. `uplift web-audit` read every tool call in every "
          f"trace: {len(exposed)} of {n} runs ({len(exposed) / n:.1%}) reached the task's own fix or newer upstream code, "
          f"and {solved(exposed)} of them solved it, against {solved(clean)} of {len(clean)} ({solved(clean) / len(clean):.1%}) "
          "of runs with docs or no web. That gap is partly easy tasks, so it doesn't measure how much the leak helped.", ""]
    md += table(["Most the run reached", "Runs", "Solved"],
                [[name, sum(r["tier"] == t for r in rows), solved([r for r in rows if r["tier"] == t])]
                 for t, name in webaudit.LABELS.items()])
    per_arm = [sum(r["arm"] == a for r in exposed) for a in b.arms]
    spread = (max(per_arm) - min(per_arm)) / (n // len(b.arms))
    md += ["", "- **By arm:** " + ", ".join(f"{analysis.ARM_LABELS.get(a, a)} {k}" for a, k in zip(b.arms, per_arm))
           + f" exposed runs of {n // len(b.arms)} each. The spread is {spread * 100:.1f} points at most, so this is "
           "unlikely to explain the comparison, and the table below tests that.",
           f"- **By set:** test {len(per_set['test'])} of {set_runs['test']} runs, fresh {len(per_set['fresh'])} of "
           f"{set_runs['fresh']}. The older test tasks are far more exposed, which clouds the test vs fresh comparison.",
           f"- **Dev batch:** {sum(r['tier'] in webaudit.EXPOSED for r in dev_rows_)} of {len(dev_rows_)} runs exposed, "
           "so the tuned arm also learned from runs with this leak.",
           "- **This is a lower bound:** URLs built at run time and search snippets are not detected.", "",
           "**Does the result survive?** Difference vs no setup in points, with 95% CI:", ""]
    arms = b.arms[1:]
    md += table(["View", "Tasks", *[analysis.ARM_LABELS.get(a, a) for a in arms]],
                [[v["view"], v["tasks"], *(f"{pts(v['arms'][a]['diff'])} ({pts(v['arms'][a]['diff_ci'][0])} to "
                                           f"{pts(v['arms'][a]['diff_ci'][1])})" for a in arms)]
                 for v in webaudit.sensitivity(b, rows)])
    return md


def limitations(submission: str) -> list[str]:
    m = re.search(r"^## Limitations.*?\n(.*?)(?=^## )", submission, re.S | re.M)
    return [ln for ln in (m.group(1) if m else "").splitlines() if ln.startswith("- ")]


def table(header: list[str], rows: list[list]) -> list[str]:
    return ["| " + " | ".join(header) + " |", "|" + " --- |" * len(header),
            *("| " + " | ".join(str(c) for c in row) + " |" for row in rows)]


def markdown(c: dict, b: analysis.Batch, *, ledger_usd: float, dev: dict, delivery: dict, failures: list[str],
             web: list[str], limits: list[str]) -> str:
    n_tasks, n_runs = len(b.tasks), len(b.results)
    arms = c["arms"]
    best_mde, worst_mde = min(a["mde"] for a in arms[1:]), max(a["mde"] for a in arms[1:])
    best_hw, worst_hw = min(a["half_width"] for a in arms[1:]), max(a["half_width"] for a in arms[1:])
    excl_zero = [a["id"] for a in arms[1:] if a["diff_ci"][0] > 0 or a["diff_ci"][1] < 0]
    verdict = ("No arm's 95% interval excludes zero: no setup is shown to differ from none." if not excl_zero
               else f"Intervals excluding zero: {', '.join(excl_zero)}.")
    md = ["# Uplift main batch: does a coding-agent setup help on sqlglot's past bugs?", "",
          f"{n_runs} agent runs of {analysis.AGENT} on {n_tasks} screened sqlglot bugs "
          f"({c['sets']['test']['tasks']} test + {c['sets']['fresh']['tasks']} fresh) × {len(b.arms)} arms × "
          f"{len(b.seeds)} repeats, graded by the repo's real tests. Total cost ${ledger_usd:.2f} from the proxy "
          f"ledger (${ledger_usd / n_runs:.3f} per run).", "",
          f"**{verdict}** A difference this study could reliably see is about {best_mde * 100:.0f}-{worst_mde * 100:.0f} "
          "points (80% power), so smaller real effects can't be ruled out.", "",
          "**Read with care:** agents could reach the web, and some looked up the real fix. See "
          "[Web access](#web-access-a-leak-the-snapshot-checks-could-not-see).", "",
          "## Solved per arm", "", f"![Solved share per arm]({CHARTS['solved']})", ""]
    md += table(["Arm", "Solved", "Rate", "95% CI", "Runs at step limit", "Regressions", "Cost", "Cost per solved"],
                [[a["label"], f"{a['solved']}/{a['attempts']}", pct(a["rate"]),
                  f"{pct(a['rate_ci'][0])} to {pct(a['rate_ci'][1])}", a["step_limit"], a["regressions"],
                  f"${a['cost']:.2f}", f"${a['cost_per_solved']:.4f}"] for a in arms])
    md += ["", f"Intervals come from a task-level bootstrap ({analysis.BOOTSTRAP_N:,} resamples, seed "
           f"{analysis.BOOTSTRAP_SEED}). Regressions are runs with any PASS_TO_PASS failure.", "",
           "## Paired difference vs no setup", "", f"![Difference vs no setup]({CHARTS['diff']})", ""]
    md += table(["Arm", "Diff (points)", "95% CI", "Tasks won", "Tasks lost", "CI half-width", "Detectable at 80% power"],
                [[a["label"], pts(a["diff"]), f"{pts(a['diff_ci'][0])} to {pts(a['diff_ci'][1])}", a["wins"], a["losses"],
                  f"±{a['half_width'] * 100:.1f}", f"{a['mde'] * 100:.1f}"] for a in arms[1:]])
    md += ["", "Won or lost means the arm solved more or fewer of a task's repeats than no setup.", "",
           "**Smallest effect we could detect.** The CI half-width "
           f"(±{best_hw * 100:.1f} to ±{worst_hw * 100:.1f} points) is the gap that would just reach significance, "
           "which a real effect of that size does only about half the time. For an 80% chance of detection the true "
           f"gap has to be {best_mde * 100:.1f} to {worst_mde * 100:.1f} points (2.8 × the bootstrap standard error). "
           f"The {len(arms) - 1} comparisons are not adjusted for multiplicity.", "",
           *web, "", "## Which tasks can show a difference", "",
           f"- Solved in every run by every arm: {c['solved_by_all']} of {n_tasks}.",
           f"- Never solved by any arm: {c['solved_by_none']} of {n_tasks}.",
           f"- The other {c['discriminating']} are the only tasks that can separate arms.",
           f"- Repeat noise: the two repeats of one arm disagreed on {c['repeats_disagree']} of {c['task_arm_pairs']} "
           "task-arm pairs, so the same setup often lands differently on the same task.", "",
           "## Test vs fresh", "", f"![Test vs fresh]({CHARTS['sets']})", ""]
    md += table(["Arm", f"Test ({c['sets']['test']['tasks']} tasks)", f"Fresh ({c['sets']['fresh']['tasks']} tasks)"],
                [[a["label"], *(f"{pct(c['sets'][s]['arms'][a['id']]['rate'])} "
                                f"({pct(c['sets'][s]['arms'][a['id']]['rate_ci'][0])} to "
                                f"{pct(c['sets'][s]['arms'][a['id']]['rate_ci'][1])})" for s in ("test", "fresh"))]
                 for a in arms])
    md += ["", "## Cost per solved bug", "", f"![Cost per solved bug]({CHARTS['cost']})", "",
           "Cost per solved is the arm's whole spend, failed runs included, divided by its solved runs. Differences "
           "between arms are small and have no interval, so read them as descriptive.", "",
           "## Hook messages", ""]
    md += table(["Arm", "Runs with a message", "Messages delivered", "Fired too late to deliver"],
                [[analysis.ARM_LABELS.get(a, a), v["runs_with_messages"], v["messages"], v["not_delivered"]]
                 for a, v in sorted(delivery.items())])
    md += ["", "Delivered means the text is in a later model request, checked against each run's trace. A Stop "
           "block on the last step is logged by the hook but never reaches the agent.", ""]
    if failures:
        md += failures + [""]
    md += ["## Dev ablation (hooks one at a time)", "",
           "Dev tasks only, screened, one repeat per task, so this is what shaped the tuned arm and not a final result.", ""]
    show = [a for a in ABLATION_ROWS if a in dev]
    md += table(["Arm", "Solved", "Wins vs none", "Losses vs none"],
                [[a, f"{dev[a]['resolved']}/{dev[a]['tasks']}", dev[a]["wins"], dev[a]["losses"]] for a in show])
    md += ["", "## Limitations", "", *limits]
    return "\n".join(md) + "\n"


def charts(c: dict, out: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.ticker import PercentFormatter

    plt.rcParams.update({"font.size": 11, "text.color": INK, "axes.labelcolor": INK_2, "xtick.color": INK_2,
                         "ytick.color": INK, "axes.edgecolor": GRID, "figure.facecolor": SURFACE,
                         "axes.facecolor": SURFACE, "svg.hashsalt": "uplift"})
    arms = c["arms"]
    labels = [a["label"] for a in arms][::-1]

    def frame(title: str, subtitle: str, height: float = 3.7):
        fig, ax = plt.subplots(figsize=(8.4, height), dpi=160)
        fig.subplots_adjust(left=0.26, right=0.96, top=0.8, bottom=0.17)
        fig.text(0.015, 0.94, title, fontsize=13.5, fontweight="bold", color=INK)
        fig.text(0.015, 0.875, subtitle, fontsize=10, color=INK_2)
        for side in ("top", "right", "left"):
            ax.spines[side].set_visible(False)
        ax.tick_params(length=0)
        ax.grid(axis="x", color=GRID, linewidth=0.8)
        ax.set_axisbelow(True)
        ax.margins(y=0.09)
        return fig, ax

    def dot(ax, x, y, lo, hi, color):
        ax.plot([lo, hi], [y, y], color=color, linewidth=2, solid_capstyle="round", zorder=2)
        ax.plot([x], [y], "o", color=color, markersize=9, markeredgecolor=SURFACE, markeredgewidth=2, zorder=3)

    def save(fig, name):
        fig.savefig(out / name, metadata={"Software": None})
        plt.close(fig)

    fig, ax = frame("Solved share per arm", "Dots are solved runs; lines are 95% bootstrap CIs over tasks. The axis does not start at 0.")
    for i, a in enumerate(arms[::-1]):
        dot(ax, a["rate"], i, *a["rate_ci"], MUTED if a["id"] == analysis.BASE else SERIES)
    ax.set_yticks(range(len(arms)), labels)
    ax.set_xlim(0.55, 0.9)
    ax.xaxis.set_major_formatter(PercentFormatter(1, decimals=0))
    save(fig, CHARTS["solved"])

    others = arms[1:]
    fig, ax = frame("Paired difference vs no setup", "Percentage points, same tasks. A line crossing 0 means no clear difference.", 3.3)
    for i, a in enumerate(others[::-1]):
        dot(ax, a["diff"] * 100, i, a["diff_ci"][0] * 100, a["diff_ci"][1] * 100, SERIES)
    ax.axvline(0, color=INK_2, linewidth=1, zorder=1)
    ax.set_yticks(range(len(others)), [a["label"] for a in others][::-1])
    ax.set_xlim(-12, 12)
    ax.xaxis.set_major_formatter(lambda v, _: f"{v:+.0f}" if v else "0")
    save(fig, CHARTS["diff"])

    fig, ax = frame("Test vs fresh tasks, per arm", "Solved share with 95% bootstrap CIs. The axis does not start at 0.", 4.3)
    sets = [("test", SERIES, 0.17, "Test"), ("fresh", SECOND, -0.17, "Fresh")]
    for name, color, shift, title in sets:
        for i, a in enumerate(arms[::-1]):
            s = c["sets"][name]["arms"][a["id"]]
            dot(ax, s["rate"], i + shift, *s["rate_ci"], color)
        ax.plot([], [], "o-", color=color, markersize=8, linewidth=2,
                label=f"{title} ({c['sets'][name]['tasks']} tasks)")
    ax.set_yticks(range(len(arms)), labels)
    ax.set_xlim(0.45, 0.95)
    ax.xaxis.set_major_formatter(PercentFormatter(1, decimals=0))
    fig.legend(loc="upper right", bbox_to_anchor=(0.965, 0.995), frameon=False, fontsize=10, ncols=2)
    save(fig, CHARTS["sets"])

    fig, ax = frame("Cost per solved bug", "Each arm's whole spend, failed runs included, divided by its solved runs.")
    for i, a in enumerate(arms[::-1]):
        ax.barh(i, a["cost_per_solved"], height=0.5, color=MUTED if a["id"] == analysis.BASE else SERIES)
        ax.text(a["cost_per_solved"] + 0.0006, i, f"${a['cost_per_solved']:.4f}", va="center", fontsize=10, color=INK)
    ax.set_yticks(range(len(arms)), labels)
    ax.set_xlim(0, 0.04)
    ax.set_xticks([0, 0.01, 0.02, 0.03, 0.04])
    ax.xaxis.set_major_formatter(lambda v, _: f"${v:.2f}")
    save(fig, CHARTS["cost"])


def write(d: Path, b: analysis.Batch, dev_plan: dict, out: Path, submission: Path, web_rows: list[dict],
          dev_web_rows: list[dict]) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    c = compute(b)
    charts(c, out)
    screened = screen.load(d / "screen" / "screened.json")
    text = markdown(c, b, ledger_usd=analysis.ledger_cost(b), dev=dev_rows(d, dev_plan, screened),
                    delivery=hook_delivery(b), failures=label.report_section(d, b),
                    web=web_section(b, web_rows, dev_web_rows), limits=limitations(submission.read_text()))
    (out / "main.md").write_text(text)
    return c
