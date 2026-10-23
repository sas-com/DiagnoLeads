#!/usr/bin/env bash
#
# Check that production answers (#51 uptime). Used by .github/workflows/uptime.yml, and can be
# run by hand: BASE_URL=https://diagnoleads-v2.vercel.app bash scripts/uptime-check.sh
#
# Prints one line per failed check and exits 1 if any failed. Only GET requests to public pages.
# The database is not checked here: a request that fails on it already emails the on-call
# address (lib/ops/alert.ts, #227).
set -uo pipefail

BASE_URL="${BASE_URL:-https://diagnoleads-v2.vercel.app}"
failed=0

# check <path> <text the body must contain>
check() {
  local path="$1" expect="$2" body status
  body="$(mktemp)"
  # Two retries 10 seconds apart: one slow cold start must not raise an alarm
  status="$(curl -sS -o "$body" -w '%{http_code}' --max-time 20 --retry 2 --retry-delay 10 \
    --retry-all-errors "${BASE_URL}${path}" 2>/dev/null)" || status="no response"
  if [ "$status" != "200" ]; then
    echo "- ${path}: HTTP ${status}"
    failed=1
  elif ! grep -q -- "$expect" "$body"; then
    echo "- ${path}: HTTP 200 but the page did not contain \"${expect}\""
    failed=1
  fi
  rm -f "$body"
}

check /api/health '"status":"ok"'
check /ja/ax-migration 'AX'
check /ja/ax-diagnosis 'AX'

exit "$failed"
