/**
 * field_glossary (Epic #780) against PostgreSQL: a field-level entry and its value entries
 * round-trip, and the two partial unique indexes keep one field-level entry per field and one
 * entry per field+value, while allowing different values for the same field. The dictionary is
 * site-wide (no organization_id), so rows are namespaced by a unique field_key prefix and cleaned
 * up afterwards.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/field-glossary.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { fieldGlossary } from '@/lib/db/schema';
import { and, eq, isNull, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('field glossary (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const ns = `test.glossary.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  afterAll(async () => {
    if (client) {
      await pg.delete(fieldGlossary).where(like(fieldGlossary.fieldKey, `${ns}%`));
      await client.end();
    }
  });

  it('round-trips a field-level entry and its value entries for the same field', async () => {
    const key = `${ns}.status`;
    await pg.insert(fieldGlossary).values([
      { fieldKey: key, value: null, labelJa: '商談ステータス', descriptionJa: 'リードの営業段階' },
      {
        fieldKey: key,
        value: 'negotiating',
        labelJa: '交渉中',
        descriptionJa: '商談を進めている段階',
        sortOrder: 1,
      },
      { fieldKey: key, value: 'won', labelJa: '成約', descriptionJa: '受注した', sortOrder: 2 },
    ]);

    const all = await pg.select().from(fieldGlossary).where(eq(fieldGlossary.fieldKey, key));
    expect(all).toHaveLength(3);

    const fieldLevel = all.filter((r) => r.value === null);
    expect(fieldLevel).toHaveLength(1);
    expect(fieldLevel[0].descriptionJa).toBe('リードの営業段階');

    const negotiating = await pg
      .select()
      .from(fieldGlossary)
      .where(and(eq(fieldGlossary.fieldKey, key), eq(fieldGlossary.value, 'negotiating')));
    expect(negotiating).toHaveLength(1);
    expect(negotiating[0].labelJa).toBe('交渉中');
    expect(negotiating[0].sortOrder).toBe(1);
  });

  it('keeps at most one field-level entry per field', async () => {
    const key = `${ns}.dup-field`;
    await pg.insert(fieldGlossary).values({ fieldKey: key, value: null, descriptionJa: 'a' });
    await expect(
      pg.insert(fieldGlossary).values({ fieldKey: key, value: null, descriptionJa: 'b' })
    ).rejects.toThrow();
  });

  it('keeps one entry per field+value but allows different values of the same field', async () => {
    const key = `${ns}.dup-value`;
    await pg.insert(fieldGlossary).values({ fieldKey: key, value: 'x', descriptionJa: 'a' });
    // A different value for the same field is fine
    await pg.insert(fieldGlossary).values({ fieldKey: key, value: 'y', descriptionJa: 'b' });
    // The same (field_key, value) is rejected
    await expect(
      pg.insert(fieldGlossary).values({ fieldKey: key, value: 'x', descriptionJa: 'c' })
    ).rejects.toThrow();

    const rows = await pg
      .select()
      .from(fieldGlossary)
      .where(and(eq(fieldGlossary.fieldKey, key), isNull(fieldGlossary.value)));
    expect(rows).toHaveLength(0);
  });
});
