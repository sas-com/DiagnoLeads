/**
 * Target company size ranges of the sales playbook (#150) on a real PostgreSQL: any member may
 * save them, and saving the rest of the playbook keeps them.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/ax-playbook-target.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { axSalesPlaybooks, organizationMembers, organizations, users } from '@/lib/db/schema';
import { emptyAxPlaybookContent } from '@/lib/features/ax-playbook/types/schemas';
import { appRouter } from '@/server/routers/_app';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('sales playbook target company size (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let organizationId: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const callers: Record<'admin' | 'member', any> = {} as never;

  const stored = async () => {
    const [row] = await pg
      .select({ content: axSalesPlaybooks.content })
      .from(axSalesPlaybooks)
      .where(eq(axSalesPlaybooks.organizationId, organizationId));
    return row?.content;
  };

  beforeAll(async () => {
    const [org] = await pg
      .insert(organizations)
      .values({ name: '手引きテスト', slug: `playbook-${unique()}` })
      .returning();
    organizationId = org.id;
    for (const role of ['admin', 'member'] as const) {
      const [user] = await pg
        .insert(users)
        .values({ email: `playbook-${role}-${unique()}@example.com`, name: role })
        .returning();
      await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
      callers[role] = appRouter.createCaller({
        db: pg,
        session: { session: { id: 's', userId: user.id }, user },
        user,
        // biome-ignore lint/suspicious/noExplicitAny: test context
      } as any);
    }
  });

  afterAll(async () => {
    if (organizationId) await pg.delete(organizations).where(eq(organizations.id, organizationId));
    await client?.end();
  });

  it('lets a member save the ranges first, and the playbook saved later keeps them', async () => {
    await callers.member.axPlaybook.updateTargetCompany({
      organizationId,
      targetCompany: { annual_revenue: ['3b_10b', '1b_3b'], employees: [], sites: [] },
    });
    expect((await stored())?.targetCompany).toEqual({
      annual_revenue: ['1b_3b', '3b_10b'],
      employees: [],
      sites: [],
    });

    const content = emptyAxPlaybookContent();
    content.basicChecks = ['稼働年数'];
    content.targetCompany.sites = ['gte10'];
    await callers.admin.axPlaybook.update({ organizationId, content });

    const after = await stored();
    expect(after?.basicChecks).toEqual(['稼働年数']);
    expect(after?.targetCompany).toEqual({
      annual_revenue: ['1b_3b', '3b_10b'],
      employees: [],
      sites: [],
    });

    // A later change of the ranges keeps the playbook text
    await callers.member.axPlaybook.updateTargetCompany({
      organizationId,
      targetCompany: { annual_revenue: [], employees: ['50_299'], sites: [] },
    });
    const latest = await stored();
    expect(latest?.basicChecks).toEqual(['稼働年数']);
    expect(latest?.targetCompany.employees).toEqual(['50_299']);

    const read = await callers.member.axPlaybook.get({ organizationId });
    expect(read).toMatchObject({ canEdit: false, canEditTargetCompany: true });
    expect(read.content?.targetCompany.employees).toEqual(['50_299']);
  });

  it('still forbids a member from saving the rest of the playbook', async () => {
    await expect(
      callers.member.axPlaybook.update({ organizationId, content: emptyAxPlaybookContent() })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
