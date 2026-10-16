#!/usr/bin/env tsx
import { db } from '@/lib/db/client';
import { accounts, organizationMembers, organizations, users } from '@/lib/db/schema';
/**
 * Seed the users and organization the E2E tests sign in with (test/e2e/helpers/auth.ts)
 * Sign-up is invite-only, so the tests cannot create them through the app.
 * Usage: bun run test:e2e:seed (against a test database only)
 */
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { E2E_ORGANIZATION, TEST_USERS } from '../test/e2e/helpers/auth';

async function seed() {
  await db
    .insert(organizations)
    .values({ id: E2E_ORGANIZATION.id, name: E2E_ORGANIZATION.name, slug: E2E_ORGANIZATION.slug })
    .onConflictDoNothing();

  for (const [role, user] of Object.entries(TEST_USERS)) {
    const existing = await db.query.users.findFirst({ where: eq(users.email, user.email) });
    if (existing) continue;

    const [created] = await db
      .insert(users)
      .values({ email: user.email, name: user.name, emailVerified: true })
      .returning();
    await db.insert(accounts).values({
      userId: created.id,
      accountId: created.id,
      providerId: 'credential',
      password: await hashPassword(user.password),
    });
    await db.insert(organizationMembers).values({
      organizationId: E2E_ORGANIZATION.id,
      userId: created.id,
      role: role as 'owner' | 'admin' | 'member',
    });
  }
  console.log(`✅ Seeded ${Object.keys(TEST_USERS).length} E2E users`);
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ E2E seeding failed:', error);
    process.exit(1);
  });
