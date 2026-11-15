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
# Withdraws the Data API grants (#1184). Run this script from the repository, not a copy, so it is found
PREPARE="$(dirname "$0")/supabase/prepare.sql"
[ -r "$PREPARE" ] || { echo "Cannot read $PREPARE; run the script from the repository." >&2; exit 1; }

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

# Supabase gives anon and authenticated full access to every new table in public, reachable through
# the Data API with the project's anon key. Withdraw the default before restoring, so the tables
# never get it even if the restore stops halfway (#1184). Run again at the end for what is left.
psql_ < "$PREPARE"

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

# Withdraw again, as for a fresh project (docs/deployment-guide.md), then make sure anon and
# authenticated cannot use any table, view or sequence in public, counting what they get through
# PUBLIC too (#1184). Turning the Data API off stays a step in the dashboard (runbook, section 4).
psql_ < "$PREPARE"
left="$(psql_ <<'SQL'
select count(*) from pg_class c
where c.relnamespace = 'public'::regnamespace
  and ((c.relkind in ('r', 'p', 'v', 'm', 'f')
        and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
          or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')))
    or (c.relkind = 'S'
        and (has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
          or has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE'))));
SQL
)"
if [ "$left" != "0" ]; then
  echo "anon or authenticated can still use $left tables or sequences in public. Do not switch to this project." >&2
  exit 1
fi
unset TARGET_URL
echo "Restored $(basename "$DUMP"). Next: section 4 of docs/runbooks/database-restore.md."
