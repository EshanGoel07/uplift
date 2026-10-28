"""Tests budget_proxy.py against a fake upstream API (no real credits used).

The fake API behaves like a real one: it never returns more output tokens than
the request's max_tokens. Run:  python3 test_budget_proxy.py
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UP_PORT, PX_PORT = 18901, 18902
HERE = os.path.dirname(os.path.abspath(__file__))
PROXY = os.path.join(HERE, "budget_proxy.py")
seen_auth = []
SPARK = (1.25, 0.15, 4.25)


def cost(inp, cached, out):
    return ((inp - cached) * SPARK[0] + cached * SPARK[1] + out * SPARK[2]) / 1e6


class FakeMeta(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        seen_auth.append(self.headers.get("Authorization"))
        mode = body.get("mode", "openai")
        inp, cached = body.get("fake_input", 1000), body.get("fake_cached", 0)
        out = body.get("max_tokens", 1000)  # a real API never exceeds max_tokens
        if body.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            if mode == "anthropic":
                events = [{"type": "message_start", "message": {"usage": {"input_tokens": inp - cached, "cache_read_input_tokens": cached, "output_tokens": 1}}},
                          {"type": "content_block_delta", "delta": {"text": "hi"}},
                          {"type": "message_delta", "usage": {"output_tokens": out}}]
            else:
                assert body.get("stream_options", {}).get("include_usage") is True, "proxy must inject include_usage"
                events = [{"choices": [{"delta": {"content": "hi"}}]},
                          {"choices": [], "usage": {"prompt_tokens": inp, "completion_tokens": out,
                                                    "prompt_tokens_details": {"cached_tokens": cached}}}]
            for e in events:
                self.wfile.write(f"data: {json.dumps(e)}\n\n".encode())
                time.sleep(0.01)
            if mode != "anthropic":
                self.wfile.write(b"data: [DONE]\n\n")
            return
        if mode == "error":
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"bad request"}')
            return
        resp = {"choices": [{"message": {"content": "hi"}}]}
        if mode != "nousage":
            resp["usage"] = {"prompt_tokens": inp, "completion_tokens": out,
                             "prompt_tokens_details": {"cached_tokens": cached}}
        data = json.dumps(resp).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)


def post(payload):
    req = urllib.request.Request(f"http://127.0.0.1:{PX_PORT}/v1/chat/completions",
                                 data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer dummy"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def status():
    with urllib.request.urlopen(f"http://127.0.0.1:{PX_PORT}/__budget") as r:
        return json.loads(r.read())


def start_proxy(cap, ledger):
    env = dict(os.environ, META_API_KEY="REAL-SECRET")
    p = subprocess.Popen([sys.executable, PROXY, "--cap", str(cap), "--port", str(PX_PORT),
                          "--upstream", f"http://127.0.0.1:{UP_PORT}", "--ledger-dir", ledger],
                         env=env, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            status()
            return p
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("proxy did not start")


def set_spent(ledger, cap, value):
    subprocess.run([sys.executable, PROXY, "--cap", str(cap), "--ledger-dir", ledger,
                    "--set-spent", str(value)], check=True, capture_output=True)


def close(a, b, tol=1e-3):
    return abs(a - b) < tol


def main():
    class Up(ThreadingHTTPServer):
        request_queue_size = 256
        daemon_threads = True

    up = Up(("127.0.0.1", UP_PORT), FakeMeta)
    threading.Thread(target=up.serve_forever, daemon=True).start()
    ledger = tempfile.mkdtemp()
    px = start_proxy(10, ledger)
    try:
        base = {"model": "muse-spark-1.3", "messages": [{"role": "user", "content": "x"}]}

        # 1. Non-streaming, with caching
        req = {**base, "max_tokens": 100_000, "fake_input": 1_000_000, "fake_cached": 400_000}
        expect = cost(1_000_000, 400_000, 100_000)
        assert post(req)[0] == 200
        assert close(status()["spent_usd"], expect), status()
        assert seen_auth[-1] == "Bearer REAL-SECRET", "proxy must swap in the real key"
        total = expect
        print(f"ok  non-streaming cost (cached input)      ${total:.4f}")

        # 2. Streaming, OpenAI style
        req = {**base, "stream": True, "max_tokens": 50_000, "fake_input": 200_000}
        assert post(req)[0] == 200
        total += cost(200_000, 0, 50_000)
        assert close(status()["spent_usd"], total), status()
        print(f"ok  openai streaming cost                  ${total:.4f}")

        # 3. Streaming, Anthropic style (with cache reads)
        req = {**base, "stream": True, "mode": "anthropic", "max_tokens": 50_000,
               "fake_input": 200_000, "fake_cached": 150_000}
        assert post(req)[0] == 200
        total += cost(200_000, 150_000, 50_000)
        assert close(status()["spent_usd"], total), status()
        print(f"ok  anthropic streaming cost               ${total:.4f}")

        # 4. Upstream error: passed through, not charged
        assert post({**base, "mode": "error"})[0] == 400
        assert close(status()["spent_usd"], total)
        print("ok  upstream 4xx passed through, not charged")

        # 5. Success but no usage reported: charged the worst-case estimate
        assert post({**base, "mode": "nousage", "max_tokens": 1000})[0] == 200
        assert status()["spent_usd"] > total
        print(f"ok  missing usage charged worst-case       +${status()['spent_usd'] - total:.4f}")

        # 6. Hackathon rule: non-Meta models are refused before leaving the machine, and never charged
        before, sent_before = status()["spent_usd"], len(seen_auth)
        for bad in ("claude-haiku-4-5", "claude-sonnet-4-6", "gpt-4o", "some-new-model"):
            code, body = post({**base, "model": bad, "max_tokens": 100})
            assert code == 403 and b"model_not_allowed" in body, (bad, code, body)
        assert status()["spent_usd"] == before and len(seen_auth) == sent_before, "blocked calls must not reach the API"
        # Meta models on Fireworks pass and are priced from the Fireworks table
        assert post({**base, "model": "accounts/fireworks/models/muse-glimmer-30b", "max_tokens": 10_000,
                     "fake_input": 0})[0] == 200
        assert close(status()["spent_usd"] - before, 10_000 * 1.50 / 1e6)
        print("ok  non-Meta models blocked (403, never sent); Fireworks Muse model allowed and priced")

        # 6b. External spend (e.g. a Muse Code run) joins the same running total
        before = status()["spent_usd"]
        req = urllib.request.Request(f"http://127.0.0.1:{PX_PORT}/__budget/add",
                                     data=json.dumps({"model": "muse-spark-1.3-contributor", "input_tokens": 1_000_000,
                                                      "cached_tokens": 900_000, "output_tokens": 30_000,
                                                      "label": "muse-code run"}).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            assert r.status == 200
        expect_add = (100_000 * 0.10 + 900_000 * 0.002 + 30_000 * 0.20) / 1e6
        assert close(status()["spent_usd"] - before, expect_add, 1e-4), status()
        req = urllib.request.Request(f"http://127.0.0.1:{PX_PORT}/__budget/add", data=b'{"usd": 0.5}',
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            assert r.status == 200
        assert close(status()["spent_usd"] - before, expect_add + 0.5, 1e-4)
        print(f"ok  external spend recorded in the same total (+${expect_add + 0.5:.4f})")

        # 7. Pre-flight refusal, --set-spent sync and persistence across restarts
        px.terminate(); px.wait()
        set_spent(ledger, 10, 9.99)
        px = start_proxy(10, ledger)
        assert close(status()["spent_usd"], 9.99)
        code, body = post({**base, "max_tokens": 100_000})  # worst case ~$0.53 > $0.01 left
        assert code == 402 and b"budget_cap_reached" in body
        print("ok  pre-flight refusal (402) + --set-spent + persistence")

        # 8. Concurrency stress: 40 parallel requests against a $5 cap.
        #    Spend must NEVER exceed the cap, and once blocked, everything is blocked.
        px.terminate(); px.wait()
        set_spent(ledger, 5, 0)
        px = start_proxy(5, ledger)
        # Honest request: 100k input tokens means a body of roughly 300k+ characters.
        big = {**base, "messages": [{"role": "user", "content": "x" * 300_000}]}
        req = {**big, "stream": True, "max_tokens": 60_000, "fake_input": 100_000}
        with ThreadPoolExecutor(40) as ex:
            codes = list(ex.map(lambda _: post(req)[0], range(40)))
        s = status()
        assert s["spent_usd"] <= 5.0, f"OVERSPENT: {s}"
        assert s["reserved_usd"] == 0
        assert codes.count(402) >= 1
        while post(req)[0] == 200:  # drain whatever budget remains
            pass
        assert status()["spent_usd"] <= 5.0
        print(f"ok  concurrency: {codes.count(200)} allowed, {codes.count(402)} blocked, "
              f"spent ${status()['spent_usd']:.4f} <= cap $5.00")

        print("\nALL TESTS PASSED: spend never exceeded the cap")
    finally:
        px.terminate()
        up.shutdown()


if __name__ == "__main__":
    main()
