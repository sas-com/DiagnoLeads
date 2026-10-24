#!/usr/bin/env bash
# Restore a dump from prod-dump.sh into a throwaway Supabase Postgres (same image family as
# production, so the extensions schema, ltree, pgcrypto, uuid-ossp and vector exist) and print
# the row count of every table, to compare with production.
#   bash prod-dump-verify.sh [dump]   # default: the newest dump
# Nothing is written to production; the container is removed at the end.
set -euo pipefail
IMAGE="supabase/postgres:17.6.1.176"
DUMP="${1:-$(ls -t "$HOME"/diagnoleads-backups/prod-*.dump | head -1)}"
NAME="dl-restore-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
trap 'docker rm -f "$NAME" > /dev/null 2>&1 || true' EXIT

docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD="$(head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')" "$IMAGE" > /dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres -h localhost > /dev/null 2>&1 && break
  sleep 2
done
# The image's init scripts run after the server first accepts connections
sleep 5

psql_() { docker exec -i "$NAME" psql -U supabase_admin -h localhost -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
psql_ -c "create extension if not exists ltree schema extensions; create extension if not exists vector schema extensions;"
docker exec -i "$NAME" pg_restore -U supabase_admin -h localhost -d postgres --no-owner --no-privileges --clean --if-exists < "$DUMP"
echo "restored: $(basename "$DUMP")"
psql_ -F' ' -c "select table_schema||'.'||table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema in ('public','drizzle') and table_type='BASE TABLE' order by 1"
