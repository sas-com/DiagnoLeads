/**
 * The indexes of the admin screens' queries (#433) exist on a real PostgreSQL with the drizzle
 * migrations applied: the lead page's activity (audit_logs), the notification bell, the lead
 * list's tags, a lead's comments, the lead list's default page and a lead found by its email
 * address. The plans of the last two are checked too.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/diagnoleads_test \
 *     bunx vitest --run test/unit/integration/admin-indexes.db.test.ts
 */
import { leads } from '@/lib/db/schema';
import { leadListOrderBy } from '@/lib/features/leads/api/list-sql';
import { and, asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

/** The organizations of the leads the plans are read on (in the test's own copy of leads) */
const ORG = '00000000-0000-4000-8000-000000000433';
const OTHER_ORG = '00000000-0000-4000-8000-000000000434';

describe.skipIf(!url)('admin indexes (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 1 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = drizzle(client!);

  afterAll(async () => {
    await client?.end();
  });

  it.each([
    ['audit_logs', 'audit_logs_org_resource_created_idx', '(organization_id, resource, resource_id, created_at)'],
    ['notifications', 'notifications_user_org_created_idx', '(user_id, organization_id, created_at)'],
    ['lead_tags', 'lead_tags_lead_idx', '(lead_id)'],
    ['lead_tags', 'lead_tags_tag_idx', '(tag_id)'],
    ['lead_comments', 'lead_comments_lead_created_idx', '(lead_id, created_at)'],
    // NULLS FIRST is the default of DESC, so PostgreSQL does not write it for id
    ['leads', 'leads_org_created_at_id_idx', '(organization_id, created_at DESC NULLS LAST, id DESC)'],
    ['leads', 'leads_org_email_lower_idx', '(organization_id, lower(email))'],
  ])('%s has %s on %s', async (table, name, columns) => {
    // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
    const rows = await client!<{ indexdef: string }[]>`
      select indexdef from pg_indexes
      where schemaname = 'public' and tablename = ${table} and indexname = ${name}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain(`USING btree ${columns}`);
  });

  it('reads the lead list page in index order and finds a lead by email through its index (#433)', async () => {
    // The list's default page: the organization, leadListOrderBy as the list uses it and a page
    // of 20 (lib/features/leads/api/router.ts). The tags, the assignee and the extras of the list
    // are read for the rows of the page only, so they do not change how the page is found.
    // The match of a public diagnosis submission: lib/features/diagnostics/lead-upsert.ts (change
    // both together)
    const listPage = pg
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.organizationId, ORG))
      .orderBy(...leadListOrderBy())
      .limit(20)
      .toSQL();
    const byEmail = pg
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.organizationId, ORG), sql`lower(${leads.email}) = ${'lead42@example.com'}`))
      .orderBy(asc(leads.createdAt))
      .limit(1)
      .toSQL();

    // The planner prefers these indexes only when an organization has many leads, and the shared
    // leads table holds few that change under the other files. The plans are read on a copy in
    // this file's own schema instead: LIKE ... INCLUDING ALL copies the migrated indexes (under
    // names of its own), filled with two organizations of 300 leads and analyzed. The queries'
    // unqualified "leads" names the copy through the search_path. Sequential scans are turned off
    // because 600 leads are still too few for the planner to prefer an index on its own
    // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
    const db = client!;
    /** Lower-case letters, digits and _ only, so it is a plain identifier */
    const copy = `leads433_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.unsafe(`create schema ${copy}`);
    try {
      await db.unsafe(`create table ${copy}.leads (like public.leads including all)`);
      await db.unsafe(
        `insert into ${copy}.leads (organization_id, email, created_at)
          select case when n % 2 = 0 then $1::uuid else $2::uuid end, 'lead' || n || '@example.com',
            timestamp '2026-10-01 00:00:00' - n * interval '1 minute'
          from generate_series(1, 600) as n`,
        [ORG, OTHER_ORG]
      );
      await db.unsafe(`analyze ${copy}.leads`);
      const copied = await db<{ indexname: string; indexdef: string }[]>`
        select indexname, indexdef from pg_indexes where schemaname = ${copy} and tablename = 'leads'
      `;
      const copyOf = (columns: string) =>
        copied.find((row) => row.indexdef.includes(`USING btree ${columns}`))?.indexname;

      const [listPlan, emailPlan] = await db.begin(async (tx) => {
        await tx.unsafe(`set local search_path = ${copy}, public`);
        await tx`set local enable_seqscan = off`;
        const plan = async (query: { sql: string; params: unknown[] }) =>
          (await tx.unsafe(`explain ${query.sql}`, query.params as postgres.ParameterOrJSON<never>[]))
            .map((row) => String(row['QUERY PLAN']))
            .join('\n');
        return [await plan(listPage), await plan(byEmail)];
      });

      // In the index's order: no sort of the organization's leads before the page is cut
      const byCreatedAt = copyOf('(organization_id, created_at DESC NULLS LAST, id DESC)');
      expect(byCreatedAt).toBeDefined();
      expect(listPlan).toContain(`using ${byCreatedAt} on leads`);
      expect(listPlan).not.toMatch(/Sort/);
      const byEmailIndex = copyOf('(organization_id, lower(email))');
      expect(byEmailIndex).toBeDefined();
      expect(emailPlan).toContain(`using ${byEmailIndex} on leads`);
    } finally {
      await db.unsafe(`drop schema if exists ${copy} cascade`);
    }
  });
});
