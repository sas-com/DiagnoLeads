/**
 * Pre-flight check for `bun run db:migrate` (#620).
 *
 * drizzle's migrator reads the newest `created_at` in drizzle.__drizzle_migrations and runs only
 * the journal entries whose `when` is newer (node_modules/drizzle-orm/pg-core/dialect.js). An
 * entry that is not recorded and whose `when` is not newer is skipped without an error, and
 * `db:migrate` reports success. test/unit/lib/db/migrations-journal.test.ts keeps the journal in
 * the repository in order, but it cannot see a migration that is applied in production before
 * its PR is merged (.claude/rules/db-schema.md): a branch generated earlier then has an older
 * `when` than the newest row in production. This check reads the database and stops first.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { Sql } from 'postgres';

export interface JournalMigration {
  tag: string;
  when: number;
  hash: string;
}

export interface RecordedMigration {
  hash: string;
  createdAt: number;
}

export interface LedgerTable {
  schema: string;
  table: string;
}

/** drizzle's defaults, which scripts/db-migrate.ts uses. */
export const DEFAULT_LEDGER: LedgerTable = { schema: 'drizzle', table: '__drizzle_migrations' };

/**
 * Tags whose `when` is older than an earlier entry and that are already in production. The
 * journal test reads the same list.
 */
export const WHEN_OUT_OF_ORDER: readonly string[] = [
  // Generated before 0013/0014 were merged and already applied in production. Generating it again
  // would give it a newer `when`, and the migrator would run its DDL a second time
  '0015_agency_links',
];

/** The journal with the hash drizzle records for each migration (sha256 of its SQL file). */
export function readJournal(migrationsFolder: string): JournalMigration[] {
  const journal: { entries: { tag: string; when: number }[] } = JSON.parse(
    fs.readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8')
  );
  const files = readMigrationFiles({ migrationsFolder });
  return journal.entries.map((entry, index) => ({
    tag: entry.tag,
    when: entry.when,
    hash: files[index].hash,
  }));
}

/** The rows the migrator wrote, or none when it has never run on this database. */
export async function readRecorded(
  sql: Sql,
  ledger: LedgerTable = DEFAULT_LEDGER
): Promise<RecordedMigration[]> {
  const [{ found }] = await sql<{ found: boolean }[]>`
    select to_regclass(format('%I.%I', ${ledger.schema}::text, ${ledger.table}::text)) is not null as found
  `;
  if (!found) return [];
  const rows = await sql<{ hash: string; created_at: string | null }[]>`
    select hash, created_at from ${sql(ledger.schema)}.${sql(ledger.table)}
  `;
  return rows.map((row) => ({ hash: row.hash, createdAt: Number(row.created_at) }));
}

/**
 * Journal entries the migrator would skip: not recorded, and not newer than the newest row.
 *
 * An entry counts as recorded when a row has its hash or its `when` (the migrator writes `when`
 * as `created_at`), so a SQL file edited after it was applied is not reported.
 */
export function findSkipped(
  journal: JournalMigration[],
  recorded: RecordedMigration[],
  allowed: readonly string[] = WHEN_OUT_OF_ORDER
): JournalMigration[] {
  if (recorded.length === 0) return [];
  const newest = Math.max(...recorded.map((row) => row.createdAt));
  const hashes = new Set(recorded.map((row) => row.hash));
  const times = new Set(recorded.map((row) => row.createdAt));
  return journal.filter(
    (entry) =>
      !hashes.has(entry.hash) &&
      !times.has(entry.when) &&
      entry.when <= newest &&
      !allowed.includes(entry.tag)
  );
}

/** Rows that no journal entry matches: usually another branch's migration applied before merge. */
export function findUnknown(
  journal: JournalMigration[],
  recorded: RecordedMigration[]
): RecordedMigration[] {
  const hashes = new Set(journal.map((entry) => entry.hash));
  const times = new Set(journal.map((entry) => entry.when));
  return recorded.filter((row) => !hashes.has(row.hash) && !times.has(row.createdAt));
}

const stamp = (millis: number): string => `${millis} (${new Date(millis).toISOString()})`;

export function describeSkipped(
  skipped: JournalMigration[],
  recorded: RecordedMigration[],
  unknown: RecordedMigration[]
): string {
  const newest = Math.max(...recorded.map((row) => row.createdAt));
  return [
    'The migrator would skip these migrations without an error (their `when` is not newer than',
    `the newest migration recorded in the database, ${stamp(newest)}):`,
    ...skipped.map((entry) => `  ${entry.tag}  when ${stamp(entry.when)}`),
    ...(unknown.length > 0
      ? [
          'Recorded in the database but not in this journal (another branch applied before merge?):',
          ...unknown.map(
            (row) => `  created_at ${stamp(row.createdAt)}  hash ${row.hash.slice(0, 12)}`
          ),
        ]
      : []),
    'Nothing was applied. Wait until the PR whose migration is already in the database is merged,',
    'merge main, delete your drizzle/<n>_*.sql, drizzle/meta/<n>_snapshot.json and journal entry,',
    'and run `bun run db:generate` again so `when` comes after it (.claude/rules/db-schema.md).',
    'If the migration was applied by hand, ask the owner: like 0015 it goes into WHEN_OUT_OF_ORDER',
    'in scripts/db-migration-ledger.ts.',
  ].join('\n');
}

/** What the migrator runs: every entry newer than the newest row (all of them on a new database). */
export function findPending(
  journal: JournalMigration[],
  recorded: RecordedMigration[]
): JournalMigration[] {
  if (recorded.length === 0) return journal;
  const newest = Math.max(...recorded.map((row) => row.createdAt));
  return journal.filter((entry) => entry.when > newest);
}

/**
 * Throws before anything is applied when the migrator would skip a migration. Only reads the
 * database, so `bun run db:migrate --check` can run it alone.
 */
export async function assertNoSkippedMigrations(
  sql: Sql,
  migrationsFolder: string,
  ledger: LedgerTable = DEFAULT_LEDGER,
  allowed: readonly string[] = WHEN_OUT_OF_ORDER
): Promise<{ recorded: number; pending: string[] }> {
  const journal = readJournal(migrationsFolder);
  const recorded = await readRecorded(sql, ledger);
  const skipped = findSkipped(journal, recorded, allowed);
  if (skipped.length > 0) {
    throw new Error(describeSkipped(skipped, recorded, findUnknown(journal, recorded)));
  }
  return {
    recorded: recorded.length,
    pending: findPending(journal, recorded).map((entry) => entry.tag),
  };
}
