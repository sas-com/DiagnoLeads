#!/usr/bin/env tsx
import { env } from '@/lib/env';
/**
 * Run database migrations
 * Usage: bun run db:migrate
 *        bun run db:migrate --check   # only reads the ledger: stops on a migration drizzle would skip
 * (with npm, --check reaches the script only after `--`: npm run db:migrate -- --check)
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { assertNoSkippedMigrations } from './db-migration-ledger';
import { describeLockTimeout, isLockTimeout, setMigrationLockTimeout } from './db-migration-lock';

const MIGRATIONS_FOLDER = './drizzle';
const checkOnly = process.argv.includes('--check');

async function runMigrations() {
  console.log(
    checkOnly ? '🔎 Checking the migration ledger...' : '🔄 Running database migrations...'
  );

  const client = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle(client);

  try {
    // drizzle skips a migration older than the newest one recorded, without an error (#620)
    const ledger = await assertNoSkippedMigrations(client, MIGRATIONS_FOLDER);
    for (const note of ledger.notes) console.warn(`⚠️  ${note}`);
    if (checkOnly) {
      console.log(`✅ No migration would be skipped (${ledger.recorded} recorded)`);
      console.log(`   Would apply: ${ledger.pending.join(', ') || 'nothing'}`);
      return;
    }
    // Give up rather than hold writes behind a lock the migration waits for (#723)
    await setMigrationLockTimeout(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('✅ Migrations completed successfully');
  } catch (error) {
    console.error(checkOnly ? '❌ Check failed:' : '❌ Migration failed:', error);
    if (isLockTimeout(error)) console.error(describeLockTimeout());
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
