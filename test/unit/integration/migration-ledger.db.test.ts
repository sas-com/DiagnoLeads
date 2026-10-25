/**
 * The db:migrate pre-flight check (#620) on a real PostgreSQL: drizzle's migrator skips, without
 * an error, a migration whose `when` is older than the newest one recorded, and the check stops
 * before that. Each test uses its own schema for the ledger and the tables it creates.
 *
 * Skipped unless TEST_DATABASE_URL points to a PostgreSQL database (no app migrations needed):
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/migration-ledger.db.test.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertNoSkippedMigrations, type LedgerTable } from '@/scripts/db-migration-ledger';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('db:migrate pre-flight check (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const sql = client!;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const db = (client ? drizzle(client) : null)!;
  let root = '';
  const schemas: string[] = [];

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-ledger-'));
  });

  afterAll(async () => {
    for (const schema of schemas) await sql`drop schema if exists ${sql(schema)} cascade`;
    await sql.end();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const newLedger = (): LedgerTable => {
    const schema = `ledger_test_${process.pid}_${schemas.length}_${Math.random().toString(36).slice(2, 8)}`;
    schemas.push(schema);
    return { schema, table: '__drizzle_migrations' };
  };

  /** A drizzle/ folder whose migrations each create one table in the ledger's schema. */
  const folder = (ledger: LedgerTable, name: string, entries: Array<[tag: string, when: number]>) => {
    const dir = path.join(root, `${ledger.schema}-${name}`);
    fs.mkdirSync(path.join(dir, 'meta'), { recursive: true });
    const journal = entries.map(([tag, when], idx) => ({ idx, version: '7', when, tag, breakpoints: true }));
    fs.writeFileSync(
      path.join(dir, 'meta/_journal.json'),
      JSON.stringify({ version: '7', dialect: 'postgresql', entries: journal })
    );
    for (const [tag] of entries) {
      const table = tag.replace(/^\d+_/, '');
      fs.writeFileSync(path.join(dir, `${tag}.sql`), `CREATE TABLE "${ledger.schema}"."${table}" (id int);`);
    }
    return dir;
  };

  const run = (dir: string, ledger: LedgerTable) =>
    migrate(db, { migrationsFolder: dir, migrationsSchema: ledger.schema, migrationsTable: ledger.table });

  const exists = async (ledger: LedgerTable, table: string) => {
    const [{ found }] = await sql<{ found: boolean }[]>`
      select to_regclass(format('%I.%I', ${ledger.schema}::text, ${table}::text)) is not null as found
    `;
    return found;
  };

  it('stops a branch generated before another branch that is already applied, which drizzle skips', async () => {
    const ledger = newLedger();
    // PR X (0001_deals, when 3000) is applied to production before it is merged
    await run(folder(ledger, 'x', [['0000_base', 1000], ['0001_deals', 3000]]), ledger);
    // PR Y generated its 0001 earlier (when 2000) and does not have X in its journal
    const y = folder(ledger, 'y', [['0000_base', 1000], ['0001_site_visits', 2000]]);

    await expect(assertNoSkippedMigrations(sql, y, ledger, [])).rejects.toThrow(
      /0001_site_visits {2}when 2000/
    );

    // Without the check, drizzle reports success and the table is never created
    await expect(run(y, ledger)).resolves.toBeUndefined();
    expect(await exists(ledger, 'deals')).toBe(true);
    expect(await exists(ledger, 'site_visits')).toBe(false);
  });

  it('passes the same branch once it is generated again after merging main', async () => {
    const ledger = newLedger();
    await run(folder(ledger, 'x', [['0000_base', 1000], ['0001_deals', 3000]]), ledger);
    const regenerated = folder(ledger, 'y', [
      ['0000_base', 1000],
      ['0001_deals', 3000],
      ['0002_site_visits', 4000],
    ]);

    await expect(assertNoSkippedMigrations(sql, regenerated, ledger, [])).resolves.toEqual({
      recorded: 2,
      pending: ['0002_site_visits'],
    });
    await run(regenerated, ledger);
    expect(await exists(ledger, 'site_visits')).toBe(true);
  });

  it('passes a database where the migrator has never run', async () => {
    const ledger = newLedger();
    const dir = folder(ledger, 'fresh', [['0000_base', 1000], ['0001_deals', 3000]]);

    await expect(assertNoSkippedMigrations(sql, dir, ledger, [])).resolves.toEqual({
      recorded: 0,
      pending: ['0000_base', '0001_deals'],
    });
  });

  it('passes a migration on the allowed list (applied by hand, like 0015)', async () => {
    const ledger = newLedger();
    await run(folder(ledger, 'x', [['0000_base', 1000], ['0001_deals', 3000]]), ledger);
    const y = folder(ledger, 'y', [['0000_base', 1000], ['0001_deals', 3000], ['0002_by_hand', 2000]]);

    await expect(assertNoSkippedMigrations(sql, y, ledger, ['0002_by_hand'])).resolves.toEqual({
      recorded: 2,
      pending: [],
    });
  });
});
