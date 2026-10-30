#!/usr/bin/env bash
# paid.sh: the ONLY way to run an uplift command that spends Meta API credit.
#
#   scripts/paid.sh run-one --repo tobymao/sqlglot --clone ~/sqlglot --task <id> [--arm NAME] [--seed N]
#   scripts/paid.sh generate --repo tobymao/sqlglot --clone ~/sqlglot     (Muse Spark, via the proxy)
#   scripts/paid.sh probe-hooks [--wrapped]                                (one tiny Muse Code run)
#   scripts/paid.sh run-batch --plan plan.json --workers 8 --max-usd 2     (at most $20 per batch)
#
# What it guarantees:
#   * the API key is loaded here, from a chmod-600 file, and never printed;
#     whoever runs this script (you or Claude Code) never sees the key;
#   * the budget proxy must be up, and at least $2 must remain under the cap;
#   * only `run-one`, `run-batch`, `generate` and `probe-hooks` are allowed, and flags that could run
#     arbitrary code with the key in the environment (--agent-cmd, --guard) are refused;
#   * `generate` only talks to the proxy (which adds the key itself), so it never gets the key;
#   * every invocation is logged to runs/paid.log (no secrets).
set -euo pipefail

KEY_FILE="${UPLIFT_KEY_FILE:-$HOME/.uplift-keys/meta.key}"
PROXY="${UPLIFT_PROXY:-http://127.0.0.1:8787}"
MIN_REMAINING="${UPLIFT_MIN_REMAINING:-2}"
UPLIFT_BIN="${UPLIFT_BIN:-uplift}"
# Tests set UPLIFT_PAID_LOG_DIR to a temp dir so they never write into the real runs/paid.log.
LOG_DIR="${UPLIFT_PAID_LOG_DIR:-$(cd "$(dirname "$0")/.." && pwd)/runs}"

die() { echo "paid.sh: $*" >&2; exit "${2:-2}"; }

case "${1:-}" in
  run-one|run-batch|generate|probe-hooks) ;;
  *) die "only 'run-one', 'run-batch', 'generate' and 'probe-hooks' are allowed (got '${1:-}')" 2 ;;
esac
for arg in "$@"; do
  case "$arg" in
    --agent-cmd*|--guard*) die "flag '$arg' is not allowed in paid runs" 2 ;;
  esac
done

if [ "$1" = "run-batch" ]; then
  python3 - "${@:2}" <<'PY' || die "run-batch needs one --max-usd above 0 and at most 20, and a readable --plan" 2
import json, math, sys
args, usd, plan = sys.argv[1:], [], []
for i, x in enumerate(args):
    for flag, found in (("--max-usd", usd), ("--plan", plan)):
        if x == flag:
            found.append(args[i + 1] if i + 1 < len(args) else "")
        elif x.startswith(flag + "="):
            found.append(x.split("=", 1)[1])
if len(usd) != 1 or len(plan) != 1:
    sys.exit(1)
max_usd = float(usd[0])
if not (math.isfinite(max_usd) and 0 < max_usd <= 20):
    sys.exit(1)
p = json.load(open(plan[0]))
print(f"plan: {len(p['runs'])} runs, estimated ${len(p['runs']) * 0.035:.2f} if none are done yet; --max-usd {max_usd}")
PY
fi

status="$(curl -sf --max-time 5 "$PROXY/__budget")" || die "budget proxy not reachable at $PROXY. Start it first." 4
python3 - "$status" "$MIN_REMAINING" <<'PY' || die "budget blocked or less than \$$MIN_REMAINING left under the cap: $status" 3
import json, sys
s = json.loads(sys.argv[1])
sys.exit(1 if s.get("blocked") or float(s.get("remaining_usd", 0)) < float(sys.argv[2]) else 0)
PY

[ -r "$KEY_FILE" ] || die "key file not found or not readable" 5
# GNU stat first (Linux); BSD/macOS stat doesn't have -c and falls through to -f.
perm="$(stat -c '%a' "$KEY_FILE" 2>/dev/null || stat -f '%Lp' "$KEY_FILE")"
[ "$perm" = "600" ] || [ "$perm" = "400" ] || die "key file permissions are $perm; run: chmod 600 <key file>" 5

mkdir -p "$LOG_DIR"
printf '%s\t%s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG_DIR/paid.log"

if [ "$1" = "generate" ]; then
  # Model calls go to the proxy, which holds the key: don't put the key in this process at all.
  UPLIFT_PROXY="$PROXY" exec "$UPLIFT_BIN" "$@"
fi
UPLIFT_PROXY="$PROXY" META_API_KEY="$(cat "$KEY_FILE")" exec "$UPLIFT_BIN" "$@"
