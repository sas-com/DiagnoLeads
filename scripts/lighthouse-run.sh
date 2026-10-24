#!/usr/bin/env bash
#
# Measure production with Lighthouse (#569, decision 2026-10-24-performance-targets). Used by
# .github/workflows/lighthouse.yml, and can be run by hand (Node 22 and Chrome needed):
#   BASE_URL=https://diagnoleads-v2.vercel.app bash scripts/lighthouse-run.sh lighthouse-reports
#
# Runs Lighthouse 13.5.0 on each page of scripts/lighthouse-pages.ts, on mobile (the default) and
# desktop (--preset=desktop), LIGHTHOUSE_RUNS times each (3), and writes one JSON report per run.
# Only measures: nothing here passes or fails on the scores (scripts/lighthouse-summary.ts makes
# the table). Exits 1 if any run produced no report, after trying all of them.
set -uo pipefail

BASE_URL="${BASE_URL:-https://diagnoleads-v2.vercel.app}"
BASE_URL="${BASE_URL%/}"
OUT_DIR="${1:-lighthouse-reports}"
RUNS="${LIGHTHOUSE_RUNS:-3}"
# Pinned: scores from another Lighthouse version are not comparable (bump it on purpose)
LIGHTHOUSE="lighthouse@13.5.0"
# Running as root (a container) needs --no-sandbox as well; the GitHub runner does not
CHROME_FLAGS="${LIGHTHOUSE_CHROME_FLAGS:---headless=new}"

# The beacons that would count each run as a visitor: Vercel Web Analytics, GA4 and our own
# /api/collect (Lighthouse's user agent is a plain Chrome one, so the bot filter of
# lib/features/site-visits does not catch it). Only the sends are blocked: the scripts still
# load and run, so their cost stays in the numbers. Lighthouse ignores the console errors of
# blocked requests (errors-in-console), so Best Practices is not affected.
BLOCKED=(
  '*/_vercel/insights/view*'
  '*/_vercel/insights/event*'
  '*/g/collect*'
  '*/api/collect*'
)
blocked_flags=()
for pattern in "${BLOCKED[@]}"; do
  blocked_flags+=("--blocked-url-patterns=${pattern}")
done

mkdir -p "$OUT_DIR"
if ! pages="$(BASE_URL="$BASE_URL" node scripts/lighthouse-pages.ts)"; then
  echo "Could not list the pages" >&2
  exit 1
fi

failed=0
for url in $pages; do
  # /ja/ax-migration/column/access-2gb-limit -> ax-migration-column-access-2gb-limit
  name="$(echo "${url#"$BASE_URL"}" | sed -e 's#^/ja/##' -e 's#/#-#g')"
  for device in mobile desktop; do
    preset=()
    if [ "$device" = desktop ]; then preset=(--preset=desktop); fi
    for run in $(seq 1 "$RUNS"); do
      report="${OUT_DIR}/${name}-${device}-${run}.report.json"
      echo "${url} ${device} ${run}/${RUNS}"
      if ! npx --yes "$LIGHTHOUSE" "$url" \
        --quiet \
        --output=json \
        --output-path="$report" \
        --only-categories=performance,accessibility,best-practices,seo \
        --chrome-flags="$CHROME_FLAGS" \
        "${preset[@]}" \
        "${blocked_flags[@]}" || [ ! -s "$report" ]; then
        echo "  no report for ${url} ${device} ${run}" >&2
        failed=1
      fi
    done
  done
done

exit "$failed"
