# Day-1 setup: money-safe from the first call

Do these steps in order on your Mac. Each one ends with a check. **Don't move on
until the check passes.** Total time: about 45 minutes.

**The rules this setup enforces:**

- Hard caps: Meta **$100** of $150, Baseten **$90** of $100, Fireworks **$90** of $100, Modal spend limit **$0** after its $100 credit.
- Only Meta models can be called at runtime: the proxies refuse every other model name.
- The API key **never** appears in your shell history, in git, or in a sandbox.
- Every paid call goes through the budget proxy, or through `guarded_muse.py` for Muse Code.
- When in doubt, the guard charges the worst case, so the cap triggers early, never late.

---

## Step 1: Lock the card (bank app, 2 min)

1. Add the card on Meta's billing page (needed to get the API key).
2. In your bank app: turn **off international transactions**. If the ₹1,200
   verification hold showed an Indian merchant in INR, also turn off
   **domestic online transactions**.
3. Refunds still come back; only new charges are blocked.

**Check:** the bank app shows international transactions OFF.

## Step 2: Put the files in place (5 min)

```bash
mkdir -p ~/uplift-hackathon/budget-guard
cd ~/uplift-hackathon/budget-guard
# move the 6 downloaded files here:
#   budget_proxy.py  guarded_muse.py  test_budget_proxy.py  test_guarded_muse.py  README.md  SETUP.md
python3 test_budget_proxy.py
python3 test_guarded_muse.py
```

**Check:** both end with `ALL ... TESTS PASSED`. These use fake APIs and cost nothing.

## Step 3: Store the keys safely (3 min)

`read -rs` takes the key without showing it, and history saves only the
command, never the key itself.

```bash
mkdir -p ~/.uplift-keys && chmod 700 ~/.uplift-keys
(umask 077; read -rs -p "Paste Meta API key: " K && printf '%s' "$K" > ~/.uplift-keys/meta.key; unset K); echo
(umask 077; read -rs -p "Paste Baseten API key: " K && printf '%s' "$K" > ~/.uplift-keys/baseten.key; unset K); echo
ls -l ~/.uplift-keys
```

**Check:** both files show `-rw-------` (only you can read them). Never paste a
key anywhere else: not in chat, not in code, not in `export ...` commands.

## Step 4: Start the Meta proxy (2 min)

Terminal tab 1 (leave it open all day):

```bash
cd ~/uplift-hackathon/budget-guard
mkdir -p meta
python3 budget_proxy.py --cap 100 --ledger-dir meta --key-file ~/.uplift-keys/meta.key
```

Terminal tab 2:

```bash
curl -s http://127.0.0.1:8787/__budget
```

**Check:** `"spent_usd": 0.0, "cap_usd": 100.0`.

If Meta's billing page already shows usage, sync it once (stop the proxy with
Ctrl+C first, then start it again after):

```bash
python3 budget_proxy.py --cap 100 --ledger-dir meta --set-spent 0.37   # the figure from the billing page
```

## Step 5: First real call, about $0.0001 (2 min)

```bash
curl -s http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer dummy" \
  -d '{"model":"muse-spark-1.3-contributor","max_tokens":20,"messages":[{"role":"user","content":"Say OK"}]}'
curl -s http://127.0.0.1:8787/__budget
```

**Check:** you get a reply, and `spent_usd` rose by a tiny amount. Open
`meta/budget_log.csv` to see the logged tokens and cost.

## Step 6: Muse Code through the guard (15 min)

Install Muse Code following Meta's docs. Then **always** start it like this, and
never as plain `muse exec`:

```bash
cd ~/uplift-hackathon/budget-guard
META_API_KEY="$(cat ~/.uplift-keys/meta.key)" python3 guarded_muse.py \
  --log-dir runs/smoke-1 -- "Create a file hello.txt containing OK"
```

(`$(cat ...)` hands the key to Muse Code without putting it in your history.)

**Check:** the last line starting `[guard]` shows `exit_code`, `reserved_usd`
(about 0.87) and `parsed_cost_usd`. Then answer the two phase-0 questions:

1. **Does `muse exec` accept `--model muse-spark-1.3-contributor`?** If it
   errors on the flag, look up Muse Code's config option for the model and pass
   it with `--model-flag`. If contributor isn't available at all, tell me and
   we'll switch the plan's fallback on.
2. **Is `parsed_cost_usd` filled in?** If it's `null`, the token usage isn't in
   the trace format we expect: send me `runs/smoke-1/stderr_trace.log` with the
   key removed and I'll adapt the parser.

## Step 7: Calibrate, then switch to real costs

Strict mode charges about $0.87 per Muse Code run, so only about 110 runs fit
under $100. That's fine for phase 0, but not for the main experiment.

1. Do 3–5 small guarded runs.
2. Wait a few hours (billing can lag), then compare Meta's billing page with
   the sum of `parsed_cost_usd` in `runs/*/guard_summary.json`.
3. **Only if the parsed sum is equal to or higher than the billing figure:**
   - sync the proxy total to the billing figure (`--set-spent`), and
   - add `--trust-usage` to every later guarded run.
4. If the billing figure is higher than the parsed sum, don't enable trust.
   Send me the numbers.

## Step 8: Baseten proxy (when you reach the open-weights phase)

```bash
mkdir -p baseten
python3 budget_proxy.py --cap 90 --port 8788 --ledger-dir baseten \
  --key-file ~/.uplift-keys/baseten.key --upstream https://<api-host-from-baseten-console>
```

Clients use `http://127.0.0.1:8788/v1` with the key `dummy`. Check Baseten's
console for the exact model ID and its price, and update `PRICES` if they differ.

## Step 8b: Fireworks proxy (for the Muse Glimmer experiment)

Store the key the same way as in step 3 (`~/.uplift-keys/fireworks.key`), then:

```bash
mkdir -p fireworks
python3 budget_proxy.py --cap 90 --port 8789 --ledger-dir fireworks \
  --key-file ~/.uplift-keys/fireworks.key --upstream https://api.fireworks.ai
```

Clients use `http://127.0.0.1:8789/inference/v1` with the key `dummy`, and model IDs
like `accounts/fireworks/models/muse-glimmer-30b`. Confirm the exact ID and price
in the Fireworks console and update `PRICES` if they differ.

**Check:** a 20-token test call works and shows up in `fireworks/budget_log.csv`.

## Step 8c: Modal hard spend limit (before any Modal job)

Modal bills compute time, not tokens, so the proxy can't meter it. Modal has its
own hard stop instead:

1. Go to modal.com/settings/usage.
2. Set **Spend limit = $0**. That's net charges *after* credits, so Modal stops
   workloads once the $100 credit is used up instead of charging your card.
3. Give every Modal function a `timeout` and avoid `keep_warm`/`min_containers`,
   so nothing runs while idle.

**Check:** the usage page shows a $0 spend limit.

## Step 8d: Only Meta models at runtime (hackathon rule)

The proxies refuse any model name that isn't a Muse model (HTTP 403), so a
non-Meta call can't slip through them. Two places could still call a non-Meta
model *outside* the proxies, so:

- **Claude Code (fallback only):** point every model slot at Muse, so it can't
  fall back to a Claude model for background tasks:

  ```bash
  export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
  export ANTHROPIC_AUTH_TOKEN=dummy
  export ANTHROPIC_MODEL=muse-spark-1.3-contributor
  export ANTHROPIC_DEFAULT_OPUS_MODEL=muse-spark-1.3-contributor
  export ANTHROPIC_DEFAULT_SONNET_MODEL=muse-spark-1.3-contributor
  export ANTHROPIC_DEFAULT_HAIKU_MODEL=muse-spark-1.3-contributor
  export CLAUDE_CODE_SUBAGENT_MODEL=muse-spark-1.3-contributor
  ```

  (These hold no secrets, so `export` is fine here.) If something still asks for
  a Claude model, the proxy blocks it and logs `BLOCKED non-Meta model`.
- **CodeProbe:** don't use `assess`, `mine --enrich` or anything else that calls an
  LLM. In our test, `assess` quietly called a Claude model. Uplift doesn't need
  CodeProbe at runtime.

Developing with Claude Code (your Claude subscription) is fine: the rule covers
models the *project* calls at runtime, not your coding tools.

## Step 9: Keep secrets out of git

In the Uplift repo's `.gitignore`:

```
.uplift-keys/
*.key
.env
meta/
baseten/
fireworks/
runs/
budget_state.json
budget_log.csv
```

**Check:** `git status` never lists a key, ledger or run folder.

---

## Daily routine (2 min)

1. `curl -s http://127.0.0.1:8787/__budget` and compare with Meta's billing page.
2. If they differ, restart the proxy with `--set-spent <billing figure>`.
3. Glance at the bank app: no new international charges.

## Emergency stop

Spending you can't explain, a key you think leaked, or a run that won't stop:

1. **Delete the API key in Meta's console.** This stops everything immediately.
2. Ctrl+C the proxy.
3. Create a new key later and redo step 3.

## What these guards can't protect against

- A script that uses the real key directly instead of the proxy or `guarded_muse.py`.
  Only `budget_proxy.py` and `guarded_muse.py` ever read the key file.
- Charges Meta makes that the API doesn't report. The daily billing check and
  the $50 gap between the $100 cap and the $150 credit cover this.
