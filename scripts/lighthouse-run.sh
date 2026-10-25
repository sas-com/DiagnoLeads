#!/usr/bin/env bash
#
# Measure production with Lighthouse (#569, decision 2026-10-24-performance-targets). Used by
# .github/workflows/lighthouse.yml, and can be run by hand (Node 22.19 or later, which
# Lighthouse 13.5.0 requires, and Chrome):
#   BASE_URL=https://diagnoleads-v2.vercel.app bash scripts/lighthouse-run.sh lighthouse-reports
#
# Runs Lighthouse 13.5.0 on each page of scripts/lighthouse-pages.ts, on mobile (the default) and
# desktop (--preset=desktop), LIGHTHOUSE_RUNS times each (3), and writes one JSON report per run.
# Only measures: nothing here passes or fails on the scores (scripts/lighthouse-summary.ts makes
# the table). A run without a report is a warning, since the other runs of that page and device
# still give a median; exits 1 only when a page and device got no report in any of its runs (or
# the pages could not be listed), after trying all of them.
set -uo pipefail

BASE_URL="${BASE_URL:-https://diagnoleads-v2.vercel.app}"
BASE_URL="${BASE_URL%/}"
OUT_DIR="${1:-lighthouse-reports}"
RUNS="${LIGHTHOUSE_RUNS:-3}"
# Pinned: scores from another Lighthouse version are not comparable (bump it on purpose)
LIGHTHOUSE="lighthouse@13.5.0"
# Running as root (a container) needs --no-sandbox as well; the GitHub runner does not
CHROME_FLAGS="${LIGHTHOUSE_CHROME_FLAGS:---headless=new}"

# The beacons that would count each run as a visitor: GA4 and our own /api/collect (on once
# launched; Lighthouse's user agent is a plain Chrome one, so the bot filter of
# lib/features/site-visits does not catch it). Only the sends are blocked: the scripts still
# load and run, so their cost stays in the numbers. Lighthouse ignores the console errors of
# blocked requests (errors-in-console), so Best Practices is not affected.
# Vercel Web Analytics is not blocked: its script sends nothing when navigator.webdriver is true,
# which it is in the headless Chrome that Lighthouse drives (its endpoints are also not under
# /_vercel/insights in production but under a project hash that Vercel may change).
BLOCKED=(
  '*/g/collect*'
  '*/api/collect*'
)
blocked_flags=()
for pattern in "${BLOCKED[@]}"; do
  blocked_flags+=("--blocked-url-patterns=${pattern}")
done

mkdir -p "$OUT_DIR"
if ! pages="$(BASE_URL="$BASE_URL" node scripts/lighthouse-pages.ts)"; then
  echo "::error::Could not list the pages"
  exit 1
fi

failed=0
for url in $pages; do
  # /ja/ax-migration/column/access-2gb-limit -> ax-migration-column-access-2gb-limit
  name="$(echo "${url#"$BASE_URL"}" | sed -e 's#^/ja/##' -e 's#/#-#g')"
  for device in mobile desktop; do
    preset=()
    if [ "$device" = desktop ]; then preset=(--preset=desktop); fi
    reports=0
    for run in $(seq 1 "$RUNS"); do
      report="${OUT_DIR}/${name}-${device}-${run}.report.json"
      echo "${url} ${device} ${run}/${RUNS}"
      if npx --yes "$LIGHTHOUSE" "$url" \
        --quiet \
        --output=json \
        --output-path="$report" \
        --only-categories=performance,accessibility,best-practices,seo \
        --chrome-flags="$CHROME_FLAGS" \
        "${preset[@]}" \
        "${blocked_flags[@]}" && [ -s "$report" ]; then
        reports=$((reports + 1))
      else
        echo "::warning::No Lighthouse report for ${url} ${device} (run ${run}/${RUNS})"
      fi
    done
    if [ "$reports" -eq 0 ]; then
      echo "::error::No Lighthouse report for ${url} ${device} in any of ${RUNS} runs"
      failed=1
    fi
  done
done

exit "$failed"
