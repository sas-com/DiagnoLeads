#!/usr/bin/env tsx
import { env } from '@/lib/env';
import { sql } from 'drizzle-orm';
/**
 * Reset database (DROP ALL TABLES and re-migrate)
 * ⚠️ WARNING: This will delete all data!
 * Usage: npm run db:reset
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

async function resetDatabase() {
  console.log('⚠️  WARNING: This will delete all data!');
  console.log('🔄 Resetting database...');

  if (env.NODE_ENV === 'production') {
    console.error('❌ Cannot reset production database!');
    process.exit(1);
  }

  const client = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle(client);

  try {
    // Drop all tables, and drizzle's ledger: with the ledger left, db:migrate applies nothing (#677)
    await db.execute(sql`DROP SCHEMA public CASCADE`);
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await db.execute(sql`CREATE SCHEMA public`);
    // Extensions installed in public go with it, and 0001 needs these two
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS ltree`);

    console.log('✅ Database reset successfully');
    console.log('🔄 Run migrations next: bun run db:migrate');
  } catch (error) {
    console.error('❌ Reset failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

resetDatabase();
