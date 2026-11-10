#!/usr/bin/env tsx
/**
 * Seed the site-wide field_glossary with the grounded initial content (Epic #780 P2).
 * Usage: bun run db:seed:field-glossary
 *
 * Idempotent and non-destructive: an entry already present (same field_key + value) is left as is,
 * so operator edits made via settings/field-glossary are never overwritten. Runs against whatever
 * DATABASE_URL points at; applying to production needs owner approval (see .claude/rules/db-schema.md),
 * and the connection string is never printed.
 */
import { db } from '@/lib/db/client';
import { fieldGlossary } from '@/lib/db/schema';
import { FIELD_GLOSSARY_SEED } from '@/lib/features/field-glossary/seed-data';
import { and, eq, isNull } from 'drizzle-orm';

async function seedFieldGlossary() {
  console.log('🌱 Seeding field_glossary...');
  let inserted = 0;
  let skipped = 0;

  for (const entry of FIELD_GLOSSARY_SEED) {
    const existing = await db
      .select({ id: fieldGlossary.id })
      .from(fieldGlossary)
      .where(
        and(
          eq(fieldGlossary.fieldKey, entry.fieldKey),
          entry.value === null ? isNull(fieldGlossary.value) : eq(fieldGlossary.value, entry.value)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    await db.insert(fieldGlossary).values({
      fieldKey: entry.fieldKey,
      value: entry.value,
      descriptionJa: entry.descriptionJa,
      descriptionEn: entry.descriptionEn,
      sortOrder: entry.sortOrder,
      updatedBy: null,
    });
    inserted++;
  }

  console.log(`✅ field_glossary seeded: ${inserted} inserted, ${skipped} already present`);
}

seedFieldGlossary()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ field_glossary seeding failed:', error);
    process.exit(1);
  });
