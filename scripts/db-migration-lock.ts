/**
 * Lock timeout for `bun run db:migrate` (#723).
 *
 * drizzle's migrator runs every pending migration in one transaction
 * (node_modules/drizzle-orm/pg-core/dialect.js), so a lock taken by the first one is held until
 * the last one commits, and CREATE INDEX cannot be CONCURRENTLY inside it. Without a timeout, a
 * long transaction on leads makes the migrator wait, and every write to the table queues behind
 * it (the public forms included). With one, the migration gives up instead: the transaction
 * rolls back, nothing is recorded in the ledger, and it can be run again later.
 *
 * It bounds each wait for a lock, not how long a lock is held once taken (a long CREATE INDEX)
 * nor the sum of several waits: those are kept short by the steps in .claude/rules/db-schema.md
 * (heavy migrations in separate runs). No statement_timeout: a correct CREATE INDEX on a large
 * table would fail with it. It is a session setting, so the migration runs on a direct
 * connection or the session pooler, never the transaction pooler (docs/deployment-guide.md).
 */

import type { Sql } from 'postgres';

/** How long each wait for a lock may last before the whole run gives up */
export const MIGRATION_LOCK_TIMEOUT = '5s';

/** PostgreSQL's lock_not_available, raised when lock_timeout runs out */
const LOCK_NOT_AVAILABLE = '55P03';

/**
 * Set lock_timeout on the session the migrator uses. The client must have a single connection
 * (`max: 1`), or the setting may land on another one.
 */
export async function setMigrationLockTimeout(
  client: Sql,
  timeout: string = MIGRATION_LOCK_TIMEOUT
): Promise<void> {
  await client`select set_config('lock_timeout', ${timeout}, false)`;
}

/** Whether `error` (drizzle wraps the driver's error in `cause`) is a lock_timeout */
export function isLockTimeout(error: unknown): boolean {
  for (let current = error; current instanceof Error || isObject(current); ) {
    if ((current as { code?: unknown }).code === LOCK_NOT_AVAILABLE) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/** What to do when a migration gave up waiting for a lock */
export function describeLockTimeout(timeout: string = MIGRATION_LOCK_TIMEOUT): string {
  return [
    `A migration waited more than ${timeout} for a lock and gave up: nothing was applied or recorded.`,
    'Find the open transactions, oldest first (any of them may hold a lock on the tables it changes):',
    '  select pid, state, xact_start, left(query, 80) from pg_stat_activity where xact_start is not null and pid <> pg_backend_pid() order by xact_start;',
    'Wait for them to finish (or end them if they are stuck), then run db:migrate again at a quiet time.',
  ].join('\n');
}
