/**
 * The organization's hearing settings (#98) on a real PostgreSQL: only owners and admins change
 * them, each change is versioned in the audit log, required fields count as missing at once, no
 * prefill into hidden fields, and an older record keeps showing the value of a hidden field.
 * All names are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/lead-hearing-settings.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  auditLogs,
  diagnosticSubmissions,
  leadHearings,
  leads,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('hearing settings (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let org: string;
  const userIds: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const callers: Record<'admin' | 'member', any> = {} as never;

  const createLead = async () => {
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId: org, email: `settings-${unique()}@example.co.jp` })
      .returning();
    return lead.id as string;
  };

  beforeAll(async () => {
    const [row] = await pg
      .insert(organizations)
      .values({ name: 'ヒアリング設定テスト', slug: `hearing-settings-${unique()}`, settings: { other: 1 } })
      .returning();
    org = row.id;
    for (const role of ['admin', 'member'] as const) {
      const [user] = await pg
        .insert(users)
        .values({ email: `hearing-settings-${role}-${unique()}@example.com`, name: role })
        .returning();
      userIds.push(user.id);
      await pg.insert(organizationMembers).values({ organizationId: org, userId: user.id, role });
      callers[role] = appRouter.createCaller({
        db: pg,
        session: { session: { id: 's', userId: user.id }, user },
        user,
        // biome-ignore lint/suspicious/noExplicitAny: test context
      } as any);
    }
  });

  afterAll(async () => {
    await pg.delete(organizations).where(eq(organizations.id, org));
    await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it('lets only owners and admins change the settings, versioned in the audit log', async () => {
    const read = await callers.member.leadHearings.catalogSettings({ organizationId: org });
    expect(read).toEqual({
      settings: { hidden: [], required: null, order: {}, customFields: [], version: 0 },
      canEdit: false,
    });
    await expect(
      callers.member.leadHearings.updateCatalogSettings({
        organizationId: org,
        settings: { hidden: ['machineModel'], required: null, order: {} },
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const settings = {
      hidden: ['machineModel'],
      required: null,
      order: { meeting: ['attendeeRoles'] },
      customFields: [],
    };
    expect(
      await callers.admin.leadHearings.updateCatalogSettings({ organizationId: org, settings })
    ).toEqual({ version: 1 });
    expect(
      await callers.admin.leadHearings.updateCatalogSettings({ organizationId: org, settings })
    ).toEqual({ version: 2 });
    expect((await callers.admin.leadHearings.catalogSettings({ organizationId: org })).settings).toEqual({
      ...settings,
      version: 2,
    });

    const [log] = await pg
      .select({ action: auditLogs.action, resource: auditLogs.resource, changes: auditLogs.changes })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, org), eq(auditLogs.resource, 'organization')))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    expect(log).toMatchObject({
      action: 'update',
      changes: {
        before: { hearingCatalog: { ...settings, version: 1 } },
        after: { hearingCatalog: { ...settings, version: 2 } },
      },
    });
    // Other settings of the organization are kept
    const [row] = await pg
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, org));
    expect(row.settings).toMatchObject({ other: 1 });
  });

  it('gives two saves at once versions one after the other', async () => {
    const before = (await callers.admin.leadHearings.catalogSettings({ organizationId: org })).settings
      .version;
    const settings = { hidden: [], required: null, order: {} };
    const results = await Promise.all([
      callers.admin.leadHearings.updateCatalogSettings({ organizationId: org, settings }),
      callers.admin.leadHearings.updateCatalogSettings({ organizationId: org, settings }),
    ]);
    expect(results.map((r: { version: number }) => r.version).sort()).toEqual([before + 1, before + 2]);
  });

  it('counts a newly required field as missing at once', async () => {
    const leadId = await createLead();
    const hearing = await callers.member.leadHearings.create({
      organizationId: org,
      leadId,
      heldOn: '2026-10-22',
    });
    expect(hearing.missing.missing).not.toContain('field:budgetStatus');

    await callers.admin.leadHearings.updateCatalogSettings({
      organizationId: org,
      settings: { hidden: [], required: ['targetSystem', 'budgetStatus'], order: {} },
    });
    const read = await callers.member.leadHearings.get({ organizationId: org, id: hearing.id });
    expect(read.missing.missing).toEqual(['system', 'field:budgetStatus']);
    const {
      items: [listed],
    } = await callers.member.leadHearings.listByLead({ organizationId: org, leadId });
    expect(listed.missingCount).toBe(2);
  });

  it('prefills nothing into hidden fields, and still shows a hidden field a record has', async () => {
    const leadId = await createLead();
    await pg.insert(diagnosticSubmissions).values({
      organizationId: org,
      leadId,
      leadCreated: true,
      diagnosticKey: 'ax-migration',
      diagnosticVersion: 2,
      answers: { platform: 'as400', timeline: 'within_1y' },
      result: { challenges: { primary: 'people', selected: ['people'] } },
    });
    await callers.admin.leadHearings.updateCatalogSettings({
      organizationId: org,
      settings: { hidden: ['targetSystem'], required: null, order: {} },
    });
    const hearing = await callers.member.leadHearings.create({
      organizationId: org,
      leadId,
      heldOn: '2026-10-22',
    });
    expect(hearing.fields.targetSystem).toBeUndefined();
    expect(hearing.fields.directionTiming?.value).toBe('within_1y');

    // A record made before the field was hidden keeps showing its value in the summary
    await pg
      .update(leadHearings)
      .set({ fields: { targetSystem: { value: 'as400', status: 'done', source: null } } })
      .where(eq(leadHearings.id, hearing.id));
    const { summary } = await callers.member.leadHearings.summary({ organizationId: org, id: hearing.id });
    const keys = summary.sections.flatMap((section: { items: { key: string }[] }) =>
      section.items.map((item) => item.key)
    );
    expect(keys).toContain('targetSystem');

    // The next hearing does not carry the hidden field's value over; the earlier one keeps it
    const next = await callers.member.leadHearings.create({ organizationId: org, leadId, heldOn: '2026-10-23' });
    expect(next.fields.targetSystem).toBeUndefined();
    const earlier = await callers.member.leadHearings.get({ organizationId: org, id: hearing.id });
    expect(earlier.fields.targetSystem?.value).toBe('as400');
  });

  it("keeps the organization's own fields: values checked, required, and readable once removed", async () => {
    const own = {
      id: 'wish0001',
      label: '導入時期の希望',
      type: 'single',
      section: 'requirements',
      options: [
        { id: 'this0001', label: '今期' },
        { id: 'next0001', label: '来期' },
      ],
    };
    await callers.admin.leadHearings.updateCatalogSettings({
      organizationId: org,
      settings: { hidden: [], required: ['custom:wish0001'], order: {}, customFields: [own] },
    });
    const leadId = await createLead();
    const hearing = await callers.member.leadHearings.create({
      organizationId: org,
      leadId,
      heldOn: '2026-10-22',
    });
    expect(hearing.missing.missing).toEqual(['field:custom:wish0001']);

    const save = (value: string, expectedUpdatedAt: Date) =>
      callers.member.leadHearings.update({
        organizationId: org,
        id: hearing.id,
        heldOn: '2026-10-22',
        fields: { 'custom:wish0001': { value, status: 'done', source: null } },
        expectedUpdatedAt,
      });
    await expect(save('nope0000', hearing.updatedAt)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const saved = await save('next0001', hearing.updatedAt);
    expect(saved.missing.missing).toEqual([]);
    const summaryItem = async () =>
      (await callers.member.leadHearings.summary({ organizationId: org, id: hearing.id })).summary.sections
        .flatMap((section: { items: { key: string; label: string; value: string | null }[] }) => section.items)
        .find((item: { key: string }) => item.key === 'custom:wish0001');
    expect(await summaryItem()).toMatchObject({ label: '導入時期の希望', value: '来期' });

    // The option and then the field are taken away: kept archived, the record still reads
    await callers.admin.leadHearings.updateCatalogSettings({
      organizationId: org,
      settings: {
        hidden: [],
        required: null,
        order: {},
        customFields: [{ ...own, options: [own.options[0]] }],
      },
    });
    await callers.admin.leadHearings.updateCatalogSettings({
      organizationId: org,
      settings: { hidden: [], required: null, order: {}, customFields: [] },
    });
    const { settings } = await callers.member.leadHearings.catalogSettings({ organizationId: org });
    expect(settings.customFields).toEqual([
      {
        ...own,
        archived: true,
        options: [own.options[0], { ...own.options[1], archived: true }],
      },
    ]);
    expect(await summaryItem()).toMatchObject({ label: '導入時期の希望', value: '来期' });
    const read = await callers.member.leadHearings.get({ organizationId: org, id: hearing.id });
    expect(read.fields['custom:wish0001']?.value).toBe('next0001');
    expect(read.missing.missing).not.toContain('field:custom:wish0001');
    // The record saves as it is, archived option and all
    await save('next0001', read.updatedAt);
    // A new hearing does not carry the removed field over
    const next = await callers.member.leadHearings.create({ organizationId: org, leadId, heldOn: '2026-10-23' });
    expect(next.fields['custom:wish0001']).toBeUndefined();
  });
});
