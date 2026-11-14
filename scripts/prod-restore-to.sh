#!/usr/bin/env bash
# Restore a dump from prod-dump.sh into a NEW, empty Supabase project (docs/runbooks/database-restore.md, 3-B).
# Never into the live production database: the target must not have any table in public yet.
#   bash scripts/prod-restore-to.sh <dump>
# The target's connection URL (session pooler, postgres user) is typed in without echo and never
# printed. The owner runs this.
set -euo pipefail
PG_IMAGE="postgres:17"
DUMP="${1:?usage: prod-restore-to.sh <dump>}"
[ -r "$DUMP" ] || { echo "Cannot read $DUMP" >&2; exit 1; }

read -rsp 'Target URL (new project, postgres user): ' TARGET_URL
echo
[ -n "$TARGET_URL" ] || { echo "No URL entered." >&2; exit 1; }
export TARGET_URL

psql_() { docker run --rm -i --network host -e TARGET_URL "$PG_IMAGE" sh -c 'psql "$TARGET_URL" -X -qAt -v ON_ERROR_STOP=1' ; }

# Refuse a database that already has application tables: this is not for the live database
existing="$(echo "select count(*) from information_schema.tables where table_schema = 'public';" | psql_)"
if [ "$existing" != "0" ]; then
  echo "The target already has $existing tables in public. Use a new, empty project." >&2
  exit 1
fi

# The dump expects these in the extensions schema, as in production
echo "create extension if not exists ltree schema extensions; create extension if not exists vector schema extensions; create extension if not exists pgcrypto schema extensions; create extension if not exists \"uuid-ossp\" schema extensions;" | psql_

# Every entry but the public schema itself (and its comment), which a Supabase project already has
list="$(mktemp)"
trap 'rm -f "$list"' EXIT
docker run --rm -i "$PG_IMAGE" pg_restore --list < "$DUMP" | grep -vE ' (SCHEMA|COMMENT - SCHEMA) (- )?public ' > "$list"
docker run --rm -i --network host -e TARGET_URL -v "$list:/restore.list:ro" "$PG_IMAGE" \
  sh -c 'pg_restore -d "$TARGET_URL" --no-owner --no-privileges --exit-on-error -L /restore.list' < "$DUMP"

# prod-dump.sh leaves out site_visit_salts (dl_readonly cannot read it, #1126); recreate it empty.
# Same definition as drizzle/0031_site_visits.sql (test/unit/scripts/prod-backup-scripts.test.ts
# keeps them equal). A day's salt is only needed that day, so nothing is lost. One transaction, so
# the table never stays without row level security. A dump that already holds it is left as is.
if [ "$(echo "select to_regclass('public.site_visit_salts') is null;" | psql_)" = "t" ]; then
  psql_ <<'SQL'
BEGIN;
CREATE TABLE "site_visit_salts" (
	"day" date PRIMARY KEY NOT NULL,
	"salt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "site_visit_salts" ENABLE ROW LEVEL SECURITY;
COMMIT;
SQL
fi
unset TARGET_URL
echo "Restored $(basename "$DUMP"). Next: section 4 of docs/runbooks/database-restore.md."
