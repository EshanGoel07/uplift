# budget-guard: a hard spending cap for the Meta Model API

Meta's console only **emails** you when you pass a limit; it never stops calls.
Once the $150 free credit is gone, usage goes onto your card. This proxy is the
stop button: every API call goes through it, and once your cap is reached it
refuses all further calls.

```
scripts / Claude Code ───────────────► budget_proxy (127.0.0.1:8787) ──► api.meta.ai
Muse Code ── guarded_muse.py ── reserve/settle ──┘   one running total, hard cap
```

Standard-library Python only. No installs.

**Start with [SETUP.md](SETUP.md):** a step-by-step, money-safe setup with a
check after every step.

The cap is **$100 of the $150 free credit**. The $50 gap covers price-table errors
and anything Meta bills that the API doesn't report.

## Our setup: one Meta key, cap $100, plus Baseten

All Meta spend runs on **one key, through one proxy, on one machine**, so there's
one running total and one cap. A second proxy with its own ledger guards Baseten.

```bash
# Meta: hard cap $100 (the free credit is $150, so real money is never reached)
# Keys live in chmod-600 files; see SETUP.md step 3. Never `export KEY=...`.
python3 budget_proxy.py --cap 100 --ledger-dir meta --key-file ~/.uplift-keys/meta.key

# Baseten (second terminal): cap $90 of the $100. Take the base URL from
# Baseten's console; the request paths (/v1/...) are forwarded as-is.
mkdir -p baseten
python3 budget_proxy.py --cap 90 --port 8788 --ledger-dir baseten \
  --key-file ~/.uplift-keys/baseten.key --upstream https://<baseten-api-host-from-console>
```

**Muse Code doesn't go through the proxy** (it has no custom API address
setting), so **every Muse Code run goes through `guarded_muse.py`**, never plain
`muse exec`:

```bash
META_API_KEY="$(cat ~/.uplift-keys/meta.key)" python3 guarded_muse.py \
  --log-dir runs/sqlglot-1001 -- "Fix the bug described in TASK.md"
```

It reserves the run's worst-case cost on the proxy before starting (refusing if
that could pass the cap), runs `muse exec` with a 40-step limit and a timeout,
then settles the real cost read from Muse Code's transport trace. Until you
calibrate in phase 0 (SETUP.md step 7), it charges the full worst case (about
$0.87 per run); after that, add `--trust-usage`.

Once the total reaches $100, the proxy blocks every Claude Code call, and
`guarded_muse.py` refuses every new Muse Code run.

## Point every client at the proxy

| Setting | Value |
|---|---|
| Base URL | `http://127.0.0.1:8787/v1` |
| API key | `dummy` (the proxy adds the real key) |

Python (OpenAI-compatible SDK):

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:8787/v1", api_key="dummy")
```

**Muse Code:** set its API base URL to the proxy the same way. Check Meta's
Muse Code docs for the exact setting. If Muse Code can't use a custom base URL,
the proxy can't see its calls; tell each other before running it at scale.

**Bonus:** sandboxes and agents only ever see `dummy`, so a misbehaving sandbox
can't leak your real key.

## Check spending

```bash
curl http://127.0.0.1:8787/__budget
```

```json
{"spent_usd": 12.41, "reserved_usd": 0.0, "cap_usd": 100.0, "remaining_usd": 87.59, "requests": 214, "blocked": false}
```

- Every call is logged to `budget_log.csv` (tokens, cost, running total), which
  you can reuse for Uplift's cost-per-fix numbers.
- The proxy prints warnings at 50%, 80% and 95% of the cap.
- At the cap, every call returns **HTTP 402 `budget_cap_reached`**. 402 is used
  instead of 429 so SDKs don't auto-retry in a loop.
- Spend is saved to `budget_state.json`, so restarting the proxy doesn't reset it.

## Before relying on it: two checks

1. **Verify the prices** in `PRICES` at the top of `budget_proxy.py` against
   Meta's pricing page. The defaults come from secondary sources. Unknown
   models are charged at the most expensive price, so errors there are safe.
2. **Do one real call, then compare** the proxy's `spent_usd` with Meta's
   billing page. If they differ, fix `PRICES` and run `--set-spent` with the
   dashboard figure.

## Daily routine

- Once a day, compare `/__budget` with the Meta billing page; if they differ,
  `--set-spent <dashboard figure>`.
- Keep `META_API_KEY` out of git: add `.env`, `budget_state.json` and
  `budget_log.csv` to `.gitignore`.

## Emergency stop

If anything looks wrong, such as spending you can't explain or a key you think
leaked: **delete the API key in the Meta console.** That stops all usage
immediately, proxy or not. Create a new key afterwards.

## What it can't protect against

- Calls that **don't go through the proxy** (a script with the real key and
  `api.meta.ai` as its URL). Only ever put the real key in the proxy's terminal.
- Charges Meta doesn't report in API responses. That's why the cap is $100,
  not $150, and why you compare with the dashboard daily.

## Tests

```bash
python3 test_budget_proxy.py
```

Runs the proxy against a fake Meta API (no credits used). It checks cost
counting (normal, streaming and cached), the key swap, error pass-through, the
hard stop, restart persistence, and 40 parallel requests never exceeding the cap.
