#!/usr/bin/env bash
# Logical backup of the production DB (schemas public, drizzle and app) as the read-only role
# dl_readonly. The project is on the Supabase Free plan, which has no automatic backups; the
# owner decided on 2026-10-24 to export daily from this PC and keep 14 days.
#   bash prod-dump.sh          # cron, hourly: skips when today's (JST) dump already exists
#   bash prod-dump.sh --now    # always dump, e.g. right before running SQL on production
# The connection URL is never printed. The cms schema is left out on purpose: dl_readonly has no
# access to it (CMS password hashes), and the CMS is off in production.
set -euo pipefail
ENV_FILE="$HOME/.config/diagnoleads/prod-ro.env"
OUT_DIR="$HOME/diagnoleads-backups"
KEEP_DAYS=14
PG_IMAGE="postgres:17"

if [ ! -r "$ENV_FILE" ] || [ "$(stat -c %a "$ENV_FILE")" != "600" ]; then
  echo "$ENV_FILE must exist with mode 600." >&2
  exit 1
fi
PGURL="$(grep '^PROD_RO_DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
case "$PGURL" in
  postgresql://dl_readonly*|postgres://dl_readonly*) ;;
  *) echo "PROD_RO_DATABASE_URL must use the dl_readonly user." >&2; exit 1 ;;
esac
export PGURL

umask 077
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

today="$(TZ=Asia/Tokyo date +%Y%m%d)"
if [ "${1:-}" != "--now" ] && compgen -G "$OUT_DIR/prod-$today-*.dump" > /dev/null; then
  exit 0
fi

name="prod-$(TZ=Asia/Tokyo date +%Y%m%d-%H%M%S).dump"
tmp="$OUT_DIR/.$name.part"
trap 'rm -f "$tmp"' EXIT

# pg_dump must not be older than the server (Postgres 17); the URL goes in by environment
docker run --rm --network host -e PGURL "$PG_IMAGE" \
  sh -c 'pg_dump "$PGURL" --format=custom --no-owner --no-privileges --schema=public --schema=drizzle --schema=app' \
  > "$tmp"

# A readable archive with tables in it, or the run fails
entries="$(docker run --rm -i "$PG_IMAGE" pg_restore --list < "$tmp" | grep -c ' TABLE DATA ' || true)"
if [ "$entries" -lt 1 ]; then
  echo "The dump has no table data; kept nothing." >&2
  exit 1
fi
mv "$tmp" "$OUT_DIR/$name"
chmod 600 "$OUT_DIR/$name"

find "$OUT_DIR" -maxdepth 1 -name 'prod-*.dump' -mtime +"$((KEEP_DAYS - 1))" -delete
echo "$(TZ=Asia/Tokyo date '+%F %T') saved $name ($(stat -c %s "$OUT_DIR/$name") bytes, $entries tables)"
