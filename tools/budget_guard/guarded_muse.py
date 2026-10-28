#!/usr/bin/env python3
"""
guarded_muse.py: run Muse Code (`muse exec`) under the budget proxy's hard cap.

Muse Code can't be pointed at the proxy, so this wrapper does the guarding:

  1. RESERVE the run's worst-case cost on the proxy BEFORE starting.
     If that could breach the cap, the run never starts (exit code 3).
  2. RUN `muse exec` with a hard step limit and a timeout.
  3. SETTLE: replace the reservation with the run's real cost, read from
     Muse Code's transport trace. Until you've verified that reading against
     Meta's billing page (phase 0), the FULL worst case is charged instead.
     That's strict: the cap triggers early, never late.

Usage (proxy must be running):
    python3 guarded_muse.py --log-dir runs/sqlglot-1001 -- "Fix the bug described in TASK.md"

Phase-0 calibration: run a few tasks, compare the "parsed cost" this prints with
Meta's billing page, and only then add --trust-usage to charge parsed costs.

Exit codes: muse's own exit code; 3 = refused by the budget; 4 = proxy unreachable.
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from budget_proxy import Usage, cost_usd, price_for  # noqa: E402


def call(proxy, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(proxy + path, data=data, headers={"Content-Type": "application/json"},
                                 method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except ValueError:
            return e.code, {}


def json_objects(text):
    """Yield JSON objects found in log lines (plain JSONL, `data: {...}` SSE lines, or prefixed lines)."""
    for line in text.splitlines():
        i = line.find("{")
        if i < 0:
            continue
        try:
            yield json.loads(line[i:])
        except ValueError:
            continue


def parse_usage(text):
    """Sum token usage over every object that carries a `usage` block.
    Over-counting (e.g. the same call reported twice) only makes the charge
    larger, which is the safe direction."""
    total, found = Usage(), 0
    for obj in json_objects(text):
        u = Usage()
        u.absorb(obj)
        if u.found:
            found += 1
            total.inp += u.inp
            total.cached += u.cached
            total.out += u.out
    total.found = found > 0
    return total, found


def main():
    ap = argparse.ArgumentParser(description="Run `muse exec` under the budget proxy's hard cap")
    ap.add_argument("--proxy", default="http://127.0.0.1:8787")
    ap.add_argument("--model", default="muse-spark-1.3-contributor")
    ap.add_argument("--max-steps", type=int, default=40)
    ap.add_argument("--max-input-per-step", type=int, default=200_000,
                    help="worst-case input tokens per model step (for the reservation)")
    ap.add_argument("--max-output-per-step", type=int, default=8_192)
    ap.add_argument("--timeout", type=int, default=1800, help="seconds before the run is killed")
    ap.add_argument("--trust-usage", action="store_true",
                    help="charge the parsed real cost (only after phase-0 calibration)")
    ap.add_argument("--muse-bin", default="muse")
    ap.add_argument("--model-flag", default="--model",
                    help="flag muse exec uses to pick a model ('' to omit)")
    ap.add_argument("--log-dir", default="runs/latest")
    ap.add_argument("muse_args", nargs=argparse.REMAINDER, help="after `--`: arguments for `muse exec`")
    a = ap.parse_args()
    args = [x for x in a.muse_args if x != "--"] if a.muse_args else []
    if not args:
        sys.exit("Give the muse exec arguments after `--`, e.g. -- \"Fix the bug in TASK.md\"")

    p_in, _, p_out = price_for(a.model)
    worst = a.max_steps * (a.max_input_per_step * p_in + a.max_output_per_step * p_out) / 1e6

    # 1. Reserve the worst case
    try:
        code, st = call(a.proxy, "/__budget/reserve", {"usd": round(worst, 6), "label": f"muse {a.log_dir}"})
    except urllib.error.URLError as e:
        print(f"[guard] proxy unreachable at {a.proxy}: {e}. Not running.", file=sys.stderr)
        sys.exit(4)
    if code != 200:
        print(f"[guard] REFUSED by budget: {st.get('error', {}).get('message', st)}", file=sys.stderr)
        sys.exit(3)
    rid = st["id"]
    print(f"[guard] reserved worst case ${worst:.3f} (spent ${st['spent_usd']:.2f} of ${st['cap_usd']:.2f})",
          file=sys.stderr)

    # 2. Run
    os.makedirs(a.log_dir, exist_ok=True)
    cmd = [a.muse_bin, "exec", "--json", "--max-model-steps", str(a.max_steps)]
    if a.model_flag:
        cmd += [a.model_flag, a.model]
    cmd += args
    env = dict(os.environ, MUSE_TRANSPORT_TRACE="1")
    out_text = err_text = ""
    rc = 1
    started = time.time()
    try:
        proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=a.timeout)
        rc, out_text, err_text = proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired as e:
        out_text = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")
        err_text = e.stderr.decode() if isinstance(e.stderr, bytes) else (e.stderr or "")
        rc = 124
        print(f"[guard] run killed after {a.timeout}s", file=sys.stderr)
    except FileNotFoundError:
        err_text = f"muse binary not found: {a.muse_bin}"
        rc = 127
    finally:
        with open(os.path.join(a.log_dir, "stdout.jsonl"), "w") as f:
            f.write(out_text)
        with open(os.path.join(a.log_dir, "stderr_trace.log"), "w") as f:
            f.write(err_text)

    # 3. Settle: prefer the transport trace (one entry per model call); else the JSONL events
    usage, n = parse_usage(err_text)
    source = "trace"
    if not usage.found:
        usage, n = parse_usage(out_text)
        source = "events"
    parsed = cost_usd(a.model, usage.inp, usage.cached, usage.out) if usage.found else None

    if rc == 127:
        settle = {"id": rid, "usd": 0.0}  # muse never started, so nothing was spent
    elif a.trust_usage and parsed is not None:
        settle = {"id": rid, "model": a.model, "input_tokens": usage.inp,
                  "cached_tokens": usage.cached, "output_tokens": usage.out}
    else:
        settle = {"id": rid}  # strict: charge the full reservation
    code, st = call(a.proxy, "/__budget/settle", settle)

    summary = {
        "exit_code": rc, "seconds": round(time.time() - started, 1), "model": a.model,
        "reserved_usd": round(worst, 4),
        "parsed_cost_usd": None if parsed is None else round(parsed, 6),
        "parsed_from": source if parsed is not None else None, "usage_records": n,
        "tokens": {"input": usage.inp, "cached": usage.cached, "output": usage.out},
        "charged": "parsed" if "input_tokens" in settle else ("none" if rc == 127 else "full reservation"),
        "spent_after_usd": st.get("spent_usd"), "cap_usd": st.get("cap_usd"),
    }
    with open(os.path.join(a.log_dir, "guard_summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    print(f"[guard] {json.dumps(summary)}", file=sys.stderr)
    if parsed is None and rc != 127:
        print("[guard] WARNING: no token usage found in muse output; charged the full worst case.", file=sys.stderr)
    sys.exit(rc)


if __name__ == "__main__":
    main()
