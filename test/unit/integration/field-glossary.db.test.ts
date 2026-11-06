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
import {
  deleteFieldGlossaryEntry,
  getFieldGlossaryEntries,
  upsertFieldGlossaryEntry,
} from '@/lib/features/field-glossary/service';
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
      // Enum labels (e.g. '商談中') live in locales/, not here; the glossary keeps descriptions
      { fieldKey: key, value: null, descriptionJa: 'リードの営業段階' },
      {
        fieldKey: key,
        value: 'negotiating',
        descriptionJa: '商談を進めている段階',
        sortOrder: 1,
      },
      { fieldKey: key, value: 'won', descriptionJa: '受注した', sortOrder: 2 },
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
    expect(negotiating[0].descriptionJa).toBe('商談を進めている段階');
    expect(negotiating[0].sortOrder).toBe(1);
  });

  it('stores label candidates for a free-text value not backed by a locale enum', async () => {
    const key = `${ns}.industry`;
    await pg.insert(fieldGlossary).values({
      fieldKey: key,
      value: 'manufacturing',
      labelJa: '製造業',
      labelEn: 'Manufacturing',
      descriptionJa: '製造・加工を主とする業種',
    });

    const rows = await pg
      .select()
      .from(fieldGlossary)
      .where(and(eq(fieldGlossary.fieldKey, key), eq(fieldGlossary.value, 'manufacturing')));
    expect(rows).toHaveLength(1);
    expect(rows[0].labelJa).toBe('製造業');
    expect(rows[0].labelEn).toBe('Manufacturing');
  });

  it('rejects an empty or whitespace-only value', async () => {
    const key = `${ns}.empty`;
    await expect(
      pg.insert(fieldGlossary).values({ fieldKey: key, value: '', descriptionJa: 'empty' })
    ).rejects.toThrow();
    await expect(
      pg.insert(fieldGlossary).values({ fieldKey: key, value: '   ', descriptionJa: 'spaces' })
    ).rejects.toThrow();
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

  it('getFieldGlossaryEntries returns each field with its values first, by sort order, for the asked keys only', async () => {
    const status = `${ns}.svc-status`;
    const owner = `${ns}.svc-owner`;
    const other = `${ns}.svc-other`;
    await pg.insert(fieldGlossary).values([
      { fieldKey: status, value: 'b', descriptionJa: 'B', sortOrder: 2 },
      { fieldKey: status, value: null, descriptionJa: 'ステータス' },
      { fieldKey: status, value: 'a', descriptionJa: 'A', sortOrder: 1 },
      { fieldKey: owner, value: null, descriptionJa: '担当' },
      { fieldKey: other, value: null, descriptionJa: '対象外' },
    ]);

    const entries = await getFieldGlossaryEntries(pg, [status, owner]);
    // Only the asked keys are returned
    expect(entries.every((e) => e.fieldKey === status || e.fieldKey === owner)).toBe(true);
    expect(entries.some((e) => e.fieldKey === other)).toBe(false);

    // Within a field: the field-level entry (value null) first, then values by sort order
    const statusValues = entries.filter((e) => e.fieldKey === status).map((e) => e.value);
    expect(statusValues).toEqual([null, 'a', 'b']);

    // An unknown key yields nothing
    expect(await getFieldGlossaryEntries(pg, [`${ns}.svc-missing`])).toEqual([]);
  });

  it('upsertFieldGlossaryEntry replaces the same field-level entry and the same value entry in place', async () => {
    const key = `${ns}.upsert`;
    const [editor] = await pg
      .insert(schema.users)
      .values({ email: `${ns}@example.com`, name: 'Editor', emailVerified: true })
      .returning({ id: schema.users.id });
    const write = (value: string | null, descriptionJa: string, sortOrder: number) =>
      upsertFieldGlossaryEntry(pg, {
        fieldKey: key,
        value,
        descriptionJa,
        descriptionEn: null,
        sortOrder,
        updatedBy: editor.id,
      });

    try {
      const first = await write(null, '項目の説明', 0);
      const again = await write(null, '書き直した説明', 0);
      expect(again.id).toBe(first.id);
      expect(again.descriptionJa).toBe('書き直した説明');

      const value = await write('negotiating', '値の説明', 3);
      const valueAgain = await write('negotiating', '値の説明（改）', 3);
      expect(valueAgain.id).toBe(value.id);
      expect(valueAgain.id).not.toBe(first.id);

      const rows = await pg.select().from(fieldGlossary).where(eq(fieldGlossary.fieldKey, key));
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.updatedBy === editor.id)).toBe(true);

      expect(await deleteFieldGlossaryEntry(pg, value.id)).toBe(true);
      expect(await deleteFieldGlossaryEntry(pg, value.id)).toBe(false);
    } finally {
      await pg.delete(fieldGlossary).where(eq(fieldGlossary.fieldKey, key));
      await pg.delete(schema.users).where(eq(schema.users.id, editor.id));
    }
  });
});
