/**
 * The indexes of the admin screens' queries (#433) exist on a real PostgreSQL with the drizzle
 * migrations applied: the lead page's activity (audit_logs), the notification bell, the lead
 * list's tags and a lead's comments.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/diagnoleads_test \
 *     bunx vitest --run test/unit/integration/admin-indexes.db.test.ts
 */
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('admin indexes (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 1 }) : null;

  afterAll(async () => {
    await client?.end();
  });

  it.each([
    ['audit_logs', 'audit_logs_org_resource_created_idx', '(organization_id, resource, resource_id, created_at)'],
    ['notifications', 'notifications_user_org_created_idx', '(user_id, organization_id, created_at)'],
    ['lead_tags', 'lead_tags_lead_idx', '(lead_id)'],
    ['lead_tags', 'lead_tags_tag_idx', '(tag_id)'],
    ['lead_comments', 'lead_comments_lead_created_idx', '(lead_id, created_at)'],
  ])('%s has %s on %s', async (table, name, columns) => {
    // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
    const rows = await client!<{ indexdef: string }[]>`
      select indexdef from pg_indexes
      where schemaname = 'public' and tablename = ${table} and indexname = ${name}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain(`USING btree ${columns}`);
  });
});
