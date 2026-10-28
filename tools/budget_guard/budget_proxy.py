#!/usr/bin/env python3
"""
budget_proxy.py: a hard spending cap for the Meta Model API.

Meta's console can email you when you pass a limit, but it never STOPS calls.
This proxy does. Point every client (your scripts, Muse Code, anything) at it
instead of the real API. It forwards each request, reads the token usage from
each response, adds up the cost, and refuses every new request once the cap is
reached, so usage cannot spill over onto your card.

Extra safety: the real API key lives only in this process. Clients (including
sandboxed agents) get a dummy key, so a leaked sandbox can't leak your key.

Standard library only. Python 3.9+.

Usage:
    python3 budget_proxy.py --cap 100  # asks for the key with a hidden prompt
                                       # (never `export KEY=...`: that lands in shell history)

    # then in clients:
    base_url = "http://127.0.0.1:8787/v1"   api_key = "dummy"

    # status (spent / cap):  curl http://127.0.0.1:8787/__budget
    # sync with the Meta billing page, e.g. if you spent $4.20 before the proxy:
    python3 budget_proxy.py --cap 100 --set-spent 4.20

PRICES BELOW ARE ASSUMPTIONS from secondary sources. Check them against Meta's
pricing page and edit PRICES before relying on the cap. Unknown models are
charged at the most expensive known price, so mistakes err on the safe side.
"""

import argparse
import csv
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# USD per 1M tokens: (input, cached_input, output). VERIFY against Meta's pricing page.
#   Source: https://dev.meta.ai/docs/pricing-rate-limits (checked 2026-10-27). Re-check before relying on it.
#   The longest matching prefix wins, so "-contributor" models get their own (much lower) price.
PRICES = {
    "muse-spark": (1.25, 0.15, 4.25),                  # standard mode: 1.3, 1.2, 1.1
    "muse-spark-1.3-contributor": (0.10, 0.002, 0.20),
    "muse-spark-1.2-contributor": (0.10, 0.002, 0.20),
    "muse-wonder": (4.00, 0.20, 20.00),
    "muse-spark-open": (1.25, 1.25, 4.25),             # Baseten, third-party listing; cache price unknown
    # Fireworks (third-party listings, 2026-10-28; verify in the Fireworks console)
    "accounts/fireworks/models/muse-spark-open": (1.25, 0.15, 4.25),
    "accounts/fireworks/models/muse-glimmer-30b": (0.35, 0.04, 1.50),
}

# Hackathon rule: every model called at runtime must be a Meta model.
# Requests naming any other model are refused (HTTP 403) before they leave your machine.
DEFAULT_ALLOWED_MODEL_PREFIXES = (
    "muse-",                                   # Meta Model API, Baseten
    "accounts/fireworks/models/muse-",         # Fireworks-hosted Muse models
)
FALLBACK_PRICE = max(PRICES.values(), key=lambda p: p[2])  # unknown model: most expensive

DEFAULT_MAX_OUTPUT = 32768   # assumed output tokens when a request doesn't set a limit (be generous)
CHARS_PER_TOKEN = 3.0        # conservative (over-)estimate for pre-flight checks
ESTIMATE_MARGIN = 1.25       # extra headroom for tokens not visible in the request (system prompts etc.)
WARN_LEVELS = (0.5, 0.8, 0.95)

HOP_BY_HOP = {"connection", "keep-alive", "transfer-encoding", "te", "trailer",
              "upgrade", "proxy-authorization", "proxy-authenticate",
              "content-length", "content-encoding", "host"}


def price_for(model):
    model = (model or "").lower()
    best = None
    for prefix in PRICES:
        if model.startswith(prefix) and (best is None or len(prefix) > len(best)):
            best = prefix
    return PRICES[best] if best else FALLBACK_PRICE


def cost_usd(model, inp, cached, out):
    p_in, p_cached, p_out = price_for(model)
    uncached = max(inp - cached, 0)
    return (uncached * p_in + cached * p_cached + out * p_out) / 1_000_000


class Usage:
    """Collects usage from OpenAI-style or Anthropic-style payloads (incl. stream chunks)."""

    def __init__(self):
        self.inp = self.cached = self.out = 0
        self.found = False

    def absorb(self, obj):
        if not isinstance(obj, dict):
            return
        u = obj.get("usage")
        if u is None and isinstance(obj.get("message"), dict):  # Anthropic message_start
            u = obj["message"].get("usage")
        if not isinstance(u, dict):
            return
        self.found = True
        # OpenAI style
        if "prompt_tokens" in u or "completion_tokens" in u:
            self.inp = max(self.inp, int(u.get("prompt_tokens") or 0))
            self.out = max(self.out, int(u.get("completion_tokens") or 0))
            det = u.get("prompt_tokens_details") or {}
            self.cached = max(self.cached, int(det.get("cached_tokens") or 0))
        # Anthropic style (input_tokens excludes cache reads/writes there)
        if "input_tokens" in u or "output_tokens" in u:
            cache_read = int(u.get("cache_read_input_tokens") or 0)
            cache_write = int(u.get("cache_creation_input_tokens") or 0)
            total_in = int(u.get("input_tokens") or 0) + cache_read + cache_write
            self.inp = max(self.inp, total_in)
            self.cached = max(self.cached, cache_read)
            self.out = max(self.out, int(u.get("output_tokens") or 0))


class Budget:
    def __init__(self, cap, ledger_dir):
        self.cap = cap
        self.lock = threading.Lock()
        self.state_path = os.path.join(ledger_dir, "budget_state.json")
        self.log_path = os.path.join(ledger_dir, "budget_log.csv")
        self.spent = 0.0
        self.reserved = 0.0
        self.requests = 0
        self.warned = set()
        self.holds = {}  # external reservations: id -> (usd, label)
        if os.path.exists(self.state_path):
            with open(self.state_path) as f:
                s = json.load(f)
            self.spent = float(s.get("spent_usd", 0.0))
            self.requests = int(s.get("requests", 0))
            self.warned = {lvl for lvl in WARN_LEVELS if self.spent >= lvl * cap}

    def _save(self):
        tmp = self.state_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"spent_usd": round(self.spent, 6), "requests": self.requests,
                       "cap_usd": self.cap, "updated": time.strftime("%Y-%m-%d %H:%M:%S")}, f, indent=2)
        os.replace(tmp, self.state_path)

    def set_spent(self, value):
        with self.lock:
            self.spent = float(value)
            self._save()

    def reserve(self, estimate):
        """Atomically reserve an estimated cost. Returns False if it would breach the cap."""
        with self.lock:
            if self.spent + self.reserved + estimate > self.cap:
                return False
            self.reserved += estimate
            return True

    def hold(self, usd, label):
        """Track an external reservation already counted in self.reserved."""
        import uuid
        rid = uuid.uuid4().hex[:12]
        with self.lock:
            self.holds[rid] = (usd, label)
        return rid

    def release(self, rid):
        with self.lock:
            return self.holds.pop(rid, None)

    def settle(self, estimate, actual, model, usage, estimated):
        with self.lock:
            self.reserved = max(self.reserved - estimate, 0.0)
            self.spent += actual
            self.requests += 1
            self._save()
            new_file = not os.path.exists(self.log_path)
            with open(self.log_path, "a", newline="") as f:
                w = csv.writer(f)
                if new_file:
                    w.writerow(["time", "model", "input_tokens", "cached_tokens", "output_tokens",
                                "cost_usd", "usage_missing_estimated", "total_spent_usd"])
                w.writerow([time.strftime("%Y-%m-%d %H:%M:%S"), model, usage.inp, usage.cached,
                            usage.out, f"{actual:.6f}", estimated, f"{self.spent:.4f}"])
            for lvl in WARN_LEVELS:
                if lvl not in self.warned and self.spent >= lvl * self.cap:
                    self.warned.add(lvl)
                    log(f"WARNING: {int(lvl * 100)}% of cap used (${self.spent:.2f} of ${self.cap:.2f})")

    def status(self):
        with self.lock:
            return {"spent_usd": round(self.spent, 4), "reserved_usd": round(self.reserved, 4),
                    "cap_usd": self.cap, "remaining_usd": round(max(self.cap - self.spent, 0), 4),
                    "requests": self.requests, "blocked": self.spent >= self.cap}


def log(msg):
    print(f"[budget-proxy {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


def make_handler(budget, upstream, api_key, allowed_prefixes=DEFAULT_ALLOWED_MODEL_PREFIXES):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"  # close after each response; keeps streaming simple

        def log_message(self, fmt, *args):
            pass

        def _json(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _refuse(self, reason):
            # 402, not 429: SDKs auto-retry 429s, which would hammer the proxy.
            log(f"BLOCKED: {reason}")
            self._json(402, {"error": {"type": "budget_cap_reached", "message":
                                       f"budget-proxy: {reason}. Raise --cap deliberately to continue."}})

        def do_GET(self):
            if self.path.rstrip("/") == "/__budget":
                return self._json(200, budget.status())
            self._forward(b"")

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b""
            path = self.path.rstrip("/")
            if path == "/__budget/add":
                return self._add_external(body)
            if path == "/__budget/reserve":
                return self._reserve_external(body)
            if path == "/__budget/settle":
                return self._settle_external(body)
            self._forward(body)

        def _reserve_external(self, body):
            """Hold a worst-case amount against the cap BEFORE a run that bypasses the proxy
            (e.g. Muse Code). Refused (402) if it could breach the cap."""
            try:
                d = json.loads(body or b"{}")
                usd = float(d["usd"])
                if usd <= 0:
                    raise ValueError("usd must be > 0")
            except (ValueError, TypeError, KeyError) as e:
                return self._json(400, {"error": {"message": f"bad /__budget/reserve body: {e}"}})
            if budget.spent >= budget.cap or not budget.reserve(usd):
                return self._refuse(f"reservation of ${usd:.2f} could exceed the ${budget.cap:.2f} cap "
                                    f"(spent ${budget.spent:.2f})")
            rid = budget.hold(usd, str(d.get("label", "external")))
            out = budget.status()
            out["id"] = rid
            return self._json(200, out)

        def _settle_external(self, body):
            """Replace a reservation with the actual cost (usd, or token counts + model).
            With no actual cost given, the FULL reservation is charged (strict default)."""
            try:
                d = json.loads(body or b"{}")
                rid = str(d["id"])
            except (ValueError, TypeError, KeyError) as e:
                return self._json(400, {"error": {"message": f"bad /__budget/settle body: {e}"}})
            held = budget.release(rid)
            if held is None:
                return self._json(404, {"error": {"message": f"unknown reservation id {rid}"}})
            usd_held, label = held
            usage = Usage()
            if "usd" in d:
                actual = float(d["usd"])
            elif "input_tokens" in d or "output_tokens" in d:
                usage.inp = int(d.get("input_tokens", 0))
                usage.cached = int(d.get("cached_tokens", 0))
                usage.out = int(d.get("output_tokens", 0))
                actual = cost_usd(d.get("model", ""), usage.inp, usage.cached, usage.out)
            else:
                actual = usd_held  # cost unknown: charge the worst case
            budget.settle(usd_held, max(actual, 0.0), "external:" + label, usage,
                          estimated=("usd" not in d and "input_tokens" not in d and "output_tokens" not in d))
            return self._json(200, budget.status())

        def _add_external(self, body):
            """Record spend that didn't go through the proxy (e.g. a Muse Code run),
            so ONE running total and ONE cap cover everything on this API key.
            Body: {"usd": 0.031, "label": "muse-code run sqlglot-1001"}
            or    {"model": "muse-spark-1.3-contributor", "input_tokens": ..., "cached_tokens": ..., "output_tokens": ...}"""
            try:
                d = json.loads(body or b"{}")
                if "usd" in d:
                    usd = float(d["usd"])
                    usage = Usage()
                else:
                    usage = Usage()
                    usage.inp = int(d.get("input_tokens", 0))
                    usage.cached = int(d.get("cached_tokens", 0))
                    usage.out = int(d.get("output_tokens", 0))
                    usd = cost_usd(d.get("model", ""), usage.inp, usage.cached, usage.out)
                if usd < 0:
                    raise ValueError("negative amount")
            except (ValueError, TypeError) as e:
                return self._json(400, {"error": {"message": f"bad /__budget/add body: {e}"}})
            budget.settle(0.0, usd, "external:" + str(d.get("label", d.get("model", "unlabelled"))),
                          usage, estimated=False)
            return self._json(200, budget.status())

        def _forward(self, body):
            model, payload = "", None
            if body:
                try:
                    payload = json.loads(body)
                    model = payload.get("model", "")
                except (ValueError, AttributeError):
                    payload = None

            if body and isinstance(payload, dict) and "model" in payload:
                m = str(payload.get("model") or "").lower()
                if not any(m.startswith(p.lower()) for p in allowed_prefixes):
                    log(f"BLOCKED non-Meta model: {payload.get('model')!r}")
                    return self._json(403, {"error": {"type": "model_not_allowed", "message":
                        f"budget-proxy: model {payload.get('model')!r} is not a Meta model; "
                        f"hackathon rule: only Meta models at runtime. Allowed prefixes: {list(allowed_prefixes)}"}})

            is_stream = isinstance(payload, dict) and payload.get("stream") is True
            # Ask OpenAI-style streams to include usage in the final chunk.
            if is_stream and "chat/completions" in self.path:
                payload.setdefault("stream_options", {})["include_usage"] = True
                body = json.dumps(payload).encode()

            # Pre-flight: assume worst case (whole body is input, full output budget used).
            max_out = DEFAULT_MAX_OUTPUT
            if isinstance(payload, dict):
                for k in ("max_tokens", "max_completion_tokens", "max_output_tokens"):
                    if payload.get(k):
                        max_out = int(payload[k])
                        break
            est_in = int(len(body) / CHARS_PER_TOKEN)
            estimate = cost_usd(model, est_in, 0, max_out) * ESTIMATE_MARGIN if body else 0.0

            if budget.spent >= budget.cap:
                return self._refuse(f"cap of ${budget.cap:.2f} reached (spent ${budget.spent:.2f})")
            if not budget.reserve(estimate):
                return self._refuse(f"this request (worst case ~${estimate:.2f}) could exceed the "
                                    f"${budget.cap:.2f} cap (spent ${budget.spent:.2f})")

            headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP
                       and k.lower() not in ("authorization", "x-api-key")}
            headers["Authorization"] = f"Bearer {api_key}"
            headers["x-api-key"] = api_key
            headers["Accept-Encoding"] = "identity"
            req = urllib.request.Request(upstream + self.path, data=body or None,
                                         headers=headers, method=self.command)
            usage = Usage()
            try:
                try:
                    resp = urllib.request.urlopen(req, timeout=600)
                except urllib.error.HTTPError as e:
                    resp = e  # upstream error: pass it through unchanged
                self.send_response(resp.status if hasattr(resp, "status") else resp.code)
                for k, v in resp.headers.items():
                    if k.lower() not in HOP_BY_HOP:
                        self.send_header(k, v)
                self.end_headers()
                ctype = resp.headers.get("Content-Type", "")
                if "text/event-stream" in ctype:
                    for line in resp:
                        self.wfile.write(line)
                        self.wfile.flush()
                        s = line.decode("utf-8", "replace").strip()
                        if s.startswith("data:"):
                            data = s[5:].strip()
                            if data and data != "[DONE]":
                                try:
                                    usage.absorb(json.loads(data))
                                except ValueError:
                                    pass
                else:
                    data = resp.read()
                    self.wfile.write(data)
                    try:
                        usage.absorb(json.loads(data))
                    except ValueError:
                        pass
                status = resp.status if hasattr(resp, "status") else resp.code
            except Exception as e:  # network failure etc.
                budget.settle(estimate, 0.0, model, usage, estimated=False)
                log(f"upstream error: {e!r}")
                try:
                    self._json(502, {"error": {"type": "proxy_upstream_error", "message": str(e)}})
                except Exception:
                    pass
                return

            if usage.found:
                actual, estimated = cost_usd(model, usage.inp, usage.cached, usage.out), False
            elif body and 200 <= status < 300:
                # Success with no usage reported: charge the worst-case estimate to stay safe.
                actual, estimated = estimate, True
                log(f"no usage in response for model '{model}'; charged worst-case ${estimate:.4f}")
            else:
                actual, estimated = 0.0, False
            budget.settle(estimate, actual, model, usage, estimated)

    return Handler


def load_api_key(key_file=None):
    """Get the real API key WITHOUT it ever appearing in shell history.

    Order: --key-file (permissions must be 600) > META_API_KEY env var (for tests)
    > hidden interactive prompt (typed key is not echoed and not saved anywhere).
    """
    if key_file:
        st = os.stat(key_file)
        if st.st_mode & 0o077:
            sys.exit(f"{key_file} is readable by other users. Run: chmod 600 {key_file}")
        with open(key_file) as f:
            key = f.read().strip()
    elif os.environ.get("META_API_KEY"):
        key = os.environ["META_API_KEY"].strip()
    else:
        import getpass
        key = getpass.getpass("Paste API key (hidden, not saved): ").strip()
    if not key:
        sys.exit("No API key given.")
    return key


def main():
    ap = argparse.ArgumentParser(description="Hard spending cap proxy for the Meta Model API")
    ap.add_argument("--cap", type=float, required=True, help="hard cap in USD (e.g. 100)")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--host", default="127.0.0.1",
                    help="keep 127.0.0.1 unless sandboxes need it; never expose publicly")
    ap.add_argument("--upstream", default=os.environ.get("META_API_ORIGIN", "https://api.meta.ai"),
                    help="API origin; request paths (e.g. /v1/chat/completions) are forwarded as-is")
    ap.add_argument("--ledger-dir", default=".")
    ap.add_argument("--set-spent", type=float, help="sync spent USD with the Meta billing page, then exit")
    ap.add_argument("--key-file", help="read the API key from this file (must be readable only by you: chmod 600)")
    ap.add_argument("--allow-model-prefix", action="append",
                    help="model-name prefix allowed through (repeatable). Default: Meta models only")
    args = ap.parse_args()

    budget = Budget(args.cap, args.ledger_dir)
    if args.set_spent is not None:
        budget.set_spent(args.set_spent)
        print(json.dumps(budget.status(), indent=2))
        return

    api_key = load_api_key(args.key_file)

    class Server(ThreadingHTTPServer):
        request_queue_size = 256  # default is 5: too small for many parallel agent runs
        daemon_threads = True

    allowed = tuple(args.allow_model_prefix or DEFAULT_ALLOWED_MODEL_PREFIXES)
    server = Server((args.host, args.port), make_handler(budget, args.upstream.rstrip("/"), api_key, allowed))
    s = budget.status()
    log(f"listening on http://{args.host}:{args.port} -> {args.upstream} | "
        f"cap ${s['cap_usd']:.2f}, already spent ${s['spent_usd']:.2f}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("stopped")


if __name__ == "__main__":
    main()
