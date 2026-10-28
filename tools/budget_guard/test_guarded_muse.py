"""Tests guarded_muse.py with a FAKE `muse` binary and the real budget proxy (no credits used).

Run:  python3 test_guarded_muse.py
"""
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
PX_PORT = 18922
PROXY = f"http://127.0.0.1:{PX_PORT}"

FAKE_MUSE = r'''#!/usr/bin/env python3
import json, os, sys, time
mode = os.environ.get("FAKE_MODE", "ok")
if mode == "hang":
    time.sleep(30)
# transport trace: one provider response per model call (OpenAI-style usage)
for i in range(3):
    print("TRACE response " + json.dumps({"id": i, "usage": {"prompt_tokens": 100000,
          "completion_tokens": 2000, "prompt_tokens_details": {"cached_tokens": 90000}}}), file=sys.stderr)
print(json.dumps({"type": "turn.completed"}))
sys.exit(1 if mode == "fail" else 0)
'''

FAKE_SILENT = "#!/usr/bin/env python3\nprint('done, no usage reported')\n"


def status():
    with urllib.request.urlopen(PROXY + "/__budget") as r:
        return json.loads(r.read())


def run_guard(fake, logdir, *extra, env=None):
    cmd = [sys.executable, os.path.join(HERE, "guarded_muse.py"), "--proxy", PROXY, "--muse-bin", fake,
           "--log-dir", logdir, *extra, "--", "Fix the bug"]
    return subprocess.run(cmd, capture_output=True, text=True, env=dict(os.environ, **(env or {})))


def main():
    tmp = tempfile.mkdtemp()
    fake = os.path.join(tmp, "muse")
    with open(fake, "w") as f:
        f.write(FAKE_MUSE)
    silent = os.path.join(tmp, "muse_silent")
    with open(silent, "w") as f:
        f.write(FAKE_SILENT)
    for p in (fake, silent):
        os.chmod(p, os.stat(p).st_mode | stat.S_IEXEC)

    ledger = os.path.join(tmp, "ledger")
    os.makedirs(ledger)
    px = subprocess.Popen([sys.executable, os.path.join(HERE, "budget_proxy.py"), "--cap", "5",
                           "--port", str(PX_PORT), "--ledger-dir", ledger],
                          env=dict(os.environ, META_API_KEY="TEST"), stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                status(); break
            except Exception:
                time.sleep(0.1)

        # Worst case for contributor defaults: 40 * (200k*0.10 + 8192*0.20)/1e6 = $0.8655
        worst = 40 * (200_000 * 0.10 + 8_192 * 0.20) / 1e6
        # Parsed real cost of the fake run: 3 calls * ((10k*0.10 + 90k*0.002 + 2k*0.20)/1e6)
        real = 3 * (10_000 * 0.10 + 90_000 * 0.002 + 2_000 * 0.20) / 1e6

        # 1. Default (strict): full worst case is charged, parsed cost is reported
        r = run_guard(fake, os.path.join(tmp, "r1"))
        assert r.returncode == 0, r.stderr
        s = json.load(open(os.path.join(tmp, "r1", "guard_summary.json")))
        assert s["charged"] == "full reservation" and abs(s["parsed_cost_usd"] - real) < 1e-9
        assert abs(status()["spent_usd"] - worst) < 1e-3, status()
        print(f"ok  strict default charges worst case ${worst:.4f} (parsed real cost ${real:.6f} logged)")

        # 2. --trust-usage: the parsed real cost is charged instead
        before = status()["spent_usd"]
        r = run_guard(fake, os.path.join(tmp, "r2"), "--trust-usage")
        assert r.returncode == 0
        assert abs(status()["spent_usd"] - before - real) < 1e-3, status()
        assert status()["reserved_usd"] == 0
        print("ok  --trust-usage charges parsed real cost")

        # 3. No usage in output: full worst case even with --trust-usage
        before = status()["spent_usd"]
        r = run_guard(silent, os.path.join(tmp, "r3"), "--trust-usage")
        assert abs(status()["spent_usd"] - before - worst) < 1e-3
        print("ok  missing usage -> full worst case charged")

        # 4. Run killed by timeout: full worst case charged, reservation released
        before = status()["spent_usd"]
        r = run_guard(fake, os.path.join(tmp, "r4"), "--timeout", "2", env={"FAKE_MODE": "hang"})
        assert r.returncode == 124
        assert abs(status()["spent_usd"] - before - worst) < 1e-3 and status()["reserved_usd"] == 0
        print("ok  timed-out run killed and charged worst case")

        # 5. Muse binary missing: nothing spent, nothing charged
        before = status()["spent_usd"]
        r = run_guard(os.path.join(tmp, "does-not-exist"), os.path.join(tmp, "r5"))
        assert r.returncode == 127 and abs(status()["spent_usd"] - before) < 1e-9
        print("ok  muse not found -> charged $0")

        # 6. Cap race: 10 parallel guarded runs against the remaining budget.
        #    Reservations must stop runs BEFORE they start; spend must never pass the cap.
        with ThreadPoolExecutor(10) as ex:
            codes = list(ex.map(lambda i: run_guard(fake, os.path.join(tmp, f"p{i}")).returncode, range(10)))
        s = status()
        assert s["spent_usd"] <= s["cap_usd"] + 1e-9, f"OVERSPENT {s}"
        assert codes.count(3) >= 1 and s["reserved_usd"] == 0, (codes, s)
        print(f"ok  parallel runs: {codes.count(0)} ran, {codes.count(3)} refused before starting; "
              f"spent ${s['spent_usd']:.4f} <= cap ${s['cap_usd']:.2f}")

        # 7. Proxy down: run refused, nothing started
        px.terminate(); px.wait()
        r = run_guard(fake, os.path.join(tmp, "r7"))
        assert r.returncode == 4 and not os.path.exists(os.path.join(tmp, "r7", "stdout.jsonl"))
        print("ok  proxy down -> run refused (exit 4), muse never started")

        print("\nALL GUARDED-MUSE TESTS PASSED: no run can start without budget, spend never passed the cap")
    finally:
        if px.poll() is None:
            px.terminate()


if __name__ == "__main__":
    main()
