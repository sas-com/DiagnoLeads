/**
 * The db:migrate lock timeout (#723) on a real PostgreSQL: a migration that waits for a lock
 * held by another session gives up after lock_timeout, the whole run rolls back and nothing is
 * recorded in the ledger, so it can be run again once the lock is gone. Each test uses its own
 * schema for the ledger and the table it changes.
 *
 * Skipped unless TEST_DATABASE_URL points to a PostgreSQL database (no app migrations needed):
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/migration-lock-timeout.db.test.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  describeLockTimeout,
  isLockTimeout,
  setMigrationLockTimeout,
} from '@/scripts/db-migration-lock';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('db:migrate lock timeout (PostgreSQL)', () => {
  // The migrator's session (one connection, as scripts/db-migrate.ts) and another session
  // that holds the lock
  const client = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
  const other = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const sql = client!;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const holder = other!;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const db = (client ? drizzle(client) : null)!;
  let root = '';
  const schemas: string[] = [];

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-lock-'));
  });

  afterAll(async () => {
    for (const schema of schemas) await sql`drop schema if exists ${sql(schema)} cascade`;
    await sql.end({ timeout: 1 });
    await holder.end({ timeout: 1 });
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** A drizzle/ folder: 0000 creates the table, 0001 adds a column to it (an exclusive lock) */
  const setUp = async () => {
    const schema = `lock_test_${process.pid}_${schemas.length}_${Math.random().toString(36).slice(2, 8)}`;
    schemas.push(schema);
    const dir = path.join(root, schema);
    fs.mkdirSync(path.join(dir, 'meta'), { recursive: true });
    const write = (entries: Array<[tag: string, when: number, statement: string]>) => {
      const journal = entries.map(([tag, when], idx) => ({ idx, version: '7', when, tag, breakpoints: true }));
      fs.writeFileSync(
        path.join(dir, 'meta/_journal.json'),
        JSON.stringify({ version: '7', dialect: 'postgresql', entries: journal })
      );
      for (const [tag, , statement] of entries) fs.writeFileSync(path.join(dir, `${tag}.sql`), statement);
    };
    const base: [string, number, string] = ['0000_base', 1000, `CREATE TABLE "${schema}"."leads" (id int);`];
    write([base]);
    const run = () => migrate(db, { migrationsFolder: dir, migrationsSchema: schema });
    await run();
    write([base, ['0001_column', 2000, `ALTER TABLE "${schema}"."leads" ADD COLUMN "note" text;`]]);
    const recorded = async () =>
      (await sql<{ n: number }[]>`select count(*)::int as n from ${sql(schema)}.__drizzle_migrations`)[0].n;
    const hasColumn = async () =>
      (
        await sql<{ found: boolean }[]>`
          select exists (select 1 from information_schema.columns
            where table_schema = ${schema} and table_name = 'leads' and column_name = 'note') as found
        `
      )[0].found;
    return { schema, run, recorded, hasColumn };
  };

  it('gives up waiting for a lock another session holds, rolls back and records nothing', async () => {
    const { schema, run, recorded, hasColumn } = await setUp();
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = () => {};
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // A long transaction that reads the table: ALTER TABLE has to wait for it
    const holding = holder.begin(async (tx) => {
      await tx`lock table ${tx(schema)}.leads in access share mode`;
      locked();
      await released;
    });
    await isLocked;
    // Lets the lock go even if the timeout stops working, so the test fails instead of hanging
    const safety = setTimeout(() => release(), 10_000);

    try {
      await setMigrationLockTimeout(sql, '200ms');
      const started = Date.now();
      const error = await run().then(
        () => null,
        (caught: unknown) => caught
      );

      expect(isLockTimeout(error)).toBe(true);
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(await recorded()).toBe(1);
      expect(await hasColumn()).toBe(false);
    } finally {
      clearTimeout(safety);
      release();
      await holding;
      // The next test starts from the setting db:migrate uses
      await setMigrationLockTimeout(sql);
    }

    // Once the lock is gone, the same run applies it
    await run();
    expect(await recorded()).toBe(2);
    expect(await hasColumn()).toBe(true);
  });

  it('applies as usual when nothing holds the lock', async () => {
    const { run, recorded, hasColumn } = await setUp();
    await setMigrationLockTimeout(sql);
    const [{ lock_timeout }] = await sql<{ lock_timeout: string }[]>`show lock_timeout`;
    expect(lock_timeout).toBe('5s');

    await run();
    expect(await recorded()).toBe(2);
    expect(await hasColumn()).toBe(true);
  });

  it('tells a lock timeout from other failures, and says what to do', () => {
    expect(isLockTimeout({ code: '55P03' })).toBe(true);
    // drizzle wraps the driver's error
    expect(isLockTimeout(Object.assign(new Error('Failed query'), { cause: { code: '55P03' } }))).toBe(true);
    expect(isLockTimeout(Object.assign(new Error('syntax'), { code: '42601' }))).toBe(false);
    expect(isLockTimeout(null)).toBe(false);
    expect(describeLockTimeout('5s')).toMatch(/nothing was applied or recorded[\s\S]*pg_stat_activity/);
  });
});
