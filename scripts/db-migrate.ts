#!/usr/bin/env tsx
import { env } from '@/lib/env';
/**
 * Run database migrations
 * Usage: npm run db:migrate
 *        npm run db:migrate --check   # only reads the ledger: stops on a migration drizzle would skip
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { assertNoSkippedMigrations } from './db-migration-ledger';

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
    if (checkOnly) {
      console.log(`✅ No migration would be skipped (${ledger.recorded} recorded)`);
      console.log(`   Would apply: ${ledger.pending.join(', ') || 'nothing'}`);
      return;
    }
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('✅ Migrations completed successfully');
  } catch (error) {
    console.error(checkOnly ? '❌ Check failed:' : '❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
