/**
 * The AX customer search list (#265) on a real PostgreSQL: who may change which rows and
 * columns, the import, the summary and turning a row into a lead. All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/prospects.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  agencyLinks,
  auditLogs,
  leadComments,
  leads,
  notifications,
  organizationMembers,
  organizations,
  prospects,
  users,
} from '@/lib/db/schema';
import { submitAxMigrationDiagnosis } from '@/lib/features/diagnostics/ax-migration/submission-service';
import { as400Answers } from '@/test/fixtures/ax-migration';
import type { OrganizationRole } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('prospects (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let organizationId: string;
  let otherOrganizationId: string;
  const ids: Record<string, string> = {};
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const callers: Record<string, any> = {};

  const base = {
    contactedOn: '2026-10-14',
    entry: 'member_network' as const,
    company: '架空製作所',
    department: '情報システム部',
    jobTitle: '部長',
    surname: '佐藤',
  };

  const addUser = async (key: string, orgId: string, role: OrganizationRole) => {
    const [user] = await pg
      .insert(users)
      .values({ email: `prospects-${key}-${unique()}@example.com`, name: `テスト ${key}` })
      .returning();
    await pg.insert(organizationMembers).values({ organizationId: orgId, userId: user.id, role });
    ids[key] = user.id;
    callers[key] = appRouter.createCaller({
      db: pg,
      session: { session: { id: `s-${key}`, userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  };

  const rowOf = async (id: string) => {
    const [row] = await pg.select().from(prospects).where(eq(prospects.id, id));
    if (!row) throw new Error('prospect not found');
    return row;
  };

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: '顧客探しテスト', slug: `prospects-${unique()}` },
        { name: '顧客探し別組織', slug: `prospects-other-${unique()}` },
      ])
      .returning({ id: organizations.id });
    organizationId = created[0].id;
    otherOrganizationId = created[1].id;
    await addUser('sales', organizationId, 'admin');
    await addUser('memberA', organizationId, 'member');
    await addUser('memberB', organizationId, 'member');
    await addUser('viewer', organizationId, 'parent_viewer');
    await addUser('outsider', otherOrganizationId, 'owner');
  });

  afterAll(async () => {
    if (organizationId) {
      await pg.delete(organizations).where(eq(organizations.id, organizationId));
      await pg.delete(organizations).where(eq(organizations.id, otherOrganizationId));
    }
    await client?.end();
  });

  it('lets a member add a row, but not write the sales columns', async () => {
    const { id } = await callers.memberA.prospects.create({
      organizationId,
      ...base,
      stage: 'contract',
      meetingOn: '2026-10-20',
      remarks: '営業だけが書く欄',
    });
    expect(await rowOf(id)).toMatchObject({
      company: '架空製作所',
      createdBy: ids.memberA,
      stage: null,
      meetingOn: null,
      remarks: null,
    });
  });

  it('lets members change only their own rows, and keeps what sales wrote', async () => {
    const { id } = await callers.memberA.prospects.create({ organizationId, ...base });
    await callers.sales.prospects.update({
      organizationId,
      id,
      ...base,
      stage: 'interest',
      salesUserId: ids.sales,
      remarks: '初回の日程調整中',
    });

    await expect(
      callers.memberB.prospects.update({ organizationId, id, ...base, heard: '書き換え' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(callers.memberB.prospects.delete({ organizationId, id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await callers.memberA.prospects.update({
      organizationId,
      id,
      ...base,
      heard: 'AS/400 で約20年',
      nextActionNote: '11月中旬',
      stage: 'contract',
    });
    expect(await rowOf(id)).toMatchObject({
      heard: 'AS/400 で約20年',
      nextActionNote: '11月中旬',
      stage: 'interest',
      salesUserId: ids.sales,
      remarks: '初回の日程調整中',
      updatedBy: ids.memberA,
    });

    const list = await callers.memberB.prospects.list({ organizationId });
    const shown = list.prospects.find((row: { id: string }) => row.id === id);
    expect(shown).toMatchObject({ canEdit: false, salesName: 'テスト sales' });
    expect(list.isSales).toBe(false);
    expect(list.members).toEqual([]);
  });

  it('only accepts someone who can hold leads here as the sales person', async () => {
    const { id } = await callers.memberA.prospects.create({ organizationId, ...base });
    for (const salesUserId of [ids.outsider, ids.viewer]) {
      await expect(
        callers.sales.prospects.update({ organizationId, id, ...base, salesUserId })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    const list = await callers.sales.prospects.list({ organizationId });
    expect(list.members.map((member: { id: string }) => member.id)).not.toContain(ids.viewer);
  });

  it('still saves a row whose sales person has left, and makes the lead without an assignee', async () => {
    await addUser('leaver', organizationId, 'member');
    const { id } = await callers.memberA.prospects.create({ organizationId, ...base, company: '退職確認' });
    await callers.sales.prospects.update({ organizationId, id, ...base, company: '退職確認', salesUserId: ids.leaver });
    await pg
      .delete(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, ids.leaver)));

    await callers.sales.prospects.update({
      organizationId,
      id,
      ...base,
      company: '退職確認',
      salesUserId: ids.leaver,
      remarks: '担当が変わる予定',
    });
    expect((await rowOf(id)).remarks).toBe('担当が変わる予定');
    const { leadId } = await callers.sales.prospects.convertToLead({
      organizationId,
      id,
      email: 'leaver-check@example.co.jp',
    });
    const [lead] = await pg.select().from(leads).where(eq(leads.id, leadId));
    expect(lead?.assigneeUserId).toBeNull();
  });

  it('rejects dates that do not exist', async () => {
    await expect(
      callers.memberA.prospects.create({ organizationId, ...base, contactedOn: '2026-02-30' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      callers.sales.prospects.setMeetingTargets({
        organizationId,
        targets: [{ month: '2026-13-01', meetings: 1 }],
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('keeps each organization to its own rows', async () => {
    const { id } = await callers.memberA.prospects.create({ organizationId, ...base });
    await expect(
      callers.outsider.prospects.update({
        organizationId: otherOrganizationId,
        id,
        ...base,
        company: '書き換え',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      callers.outsider.prospects.delete({ organizationId: otherOrganizationId, id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      callers.outsider.prospects.list({ organizationId })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const own = await callers.outsider.prospects.list({ organizationId: otherOrganizationId });
    expect(own.prospects).toEqual([]);
    expect((await rowOf(id)).company).toBe('架空製作所');
  });

  it('hides the list from viewers of a parent organization', async () => {
    await expect(callers.viewer.prospects.list({ organizationId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('filters overdue next actions and the rows of the signed-in person', async () => {
    await callers.memberB.prospects.create({
      organizationId,
      ...base,
      company: '期限切れ工業',
      nextActionOn: '2020-01-01',
    });
    const overdue = await callers.memberB.prospects.list({ organizationId, filter: 'overdue' });
    expect(overdue.prospects.map((row: { company: string }) => row.company)).toContain('期限切れ工業');
    const mine = await callers.memberB.prospects.list({ organizationId, filter: 'mine' });
    expect(mine.prospects.every((row: { createdBy: string }) => row.createdBy === ids.memberB)).toBe(true);
  });

  it('lets only sales import, keeping the spreadsheet names as text', async () => {
    const row = {
      contactedOn: '2026-10-09',
      entry: 'bp_company' as const,
      company: '架空商事',
      reaction: 'considering' as const,
      stage: 'spec_survey' as const,
      meetingOn: '2026-10-16',
      recorderName: '山田',
      salesName: '田中',
      remarks: '紹介あり',
      updatedOn: '2026-10-15',
    };
    await expect(
      callers.memberA.prospects.import({ organizationId, rows: [row] })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(await callers.sales.prospects.import({ organizationId, rows: [row] })).toEqual({
      imported: 1,
    });
    const [imported] = await pg
      .select()
      .from(prospects)
      .where(and(eq(prospects.organizationId, organizationId), eq(prospects.company, '架空商事')));
    expect(imported).toMatchObject({
      recorderName: '山田',
      stage: 'spec_survey',
      remarks: '営業担当: 田中\n紹介あり',
      createdBy: ids.sales,
    });
    expect(imported?.updatedAt.toISOString()).toBe('2026-10-14T15:00:00.000Z');
  });

  it('summarizes the rows and keeps the targets set by sales', async () => {
    await expect(
      callers.memberA.prospects.setMeetingTargets({ organizationId, targets: [] })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await callers.sales.prospects.setMeetingTargets({
      organizationId,
      targets: [
        { month: '2026-11-01', meetings: 8 },
        { month: '2026-12-01', meetings: 15 },
      ],
    });
    await callers.sales.prospects.setMeetingTargets({
      organizationId,
      targets: [{ month: '2026-11-01', meetings: 10 }],
    });

    const { summary, targets } = await callers.memberA.prospects.summary({ organizationId });
    expect(targets).toEqual([{ month: '2026-11-01', meetings: 10 }]);
    const total = (await pg.select().from(prospects).where(eq(prospects.organizationId, organizationId)))
      .length;
    expect(summary.overall.total).toBe(total);
    expect(summary.overall.meetings).toBe(1);
    expect(summary.entries.find((e: { entry: string }) => e.entry === 'bp_company')?.byStage.spec_survey).toBe(1);
    expect(summary.months.find((m: { month: string }) => m.month === '2026-11-01')).toMatchObject({
      target: 10,
      meetingsToDate: 1,
      gap: -9,
    });
  });

  it('lets sales turn a row into a lead once, with an audit row', async () => {
    const { id } = await callers.memberA.prospects.create({
      organizationId,
      ...base,
      entry: 'existing_end_customer',
      company: '架空電機',
    });
    await callers.sales.prospects.update({
      organizationId,
      id,
      ...base,
      entry: 'existing_end_customer',
      company: '架空電機',
      salesUserId: ids.sales,
    });
    await expect(
      callers.memberA.prospects.convertToLead({ organizationId, id, email: 'sato@example.co.jp' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const { leadId } = await callers.sales.prospects.convertToLead({
      organizationId,
      id,
      email: 'sato@example.co.jp',
      name: '佐藤 一郎',
    });
    const [lead] = await pg.select().from(leads).where(eq(leads.id, leadId));
    expect(lead).toMatchObject({
      organizationId,
      email: 'sato@example.co.jp',
      name: '佐藤 一郎',
      company: '架空電機',
      status: 'new',
      inflowSource: 'existing_customer',
      conversionPoint: 'via_sales',
      assigneeUserId: ids.sales,
    });
    expect((await rowOf(id)).leadId).toBe(leadId);
    const audit = await pg.select().from(auditLogs).where(eq(auditLogs.resourceId, leadId));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toEqual({ prospectId: id });

    await expect(
      callers.sales.prospects.convertToLead({ organizationId, id, email: 'other@example.co.jp' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('gives each employee one referral link that attributes a diagnosis to them', async () => {
    const first = await callers.memberA.prospects.myReferralLink({ organizationId });
    const again = await callers.memberA.prospects.myReferralLink({ organizationId });
    expect(again.url).toBe(first.url);
    expect(first.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const code = new URL(first.url).searchParams.get('agency');
    expect(code).toBeTruthy();

    const outcome = await submitAxMigrationDiagnosis(
      pg as unknown as Parameters<typeof submitAxMigrationDiagnosis>[0],
      organizationId,
      {
        answers: as400Answers,
        contact: { company: '紹介工業', name: '紹介 太郎', email: `referral-${unique()}@example.co.jp` },
        privacyConsent: true,
        consultationRequested: false,
        tracking: { agency: code ?? undefined },
        locale: 'ja',
      },
      new Date('2026-10-21T01:00:00Z')
    );
    if (!outcome.ok) throw new Error('submission failed');
    expect(outcome.referralMemberUserId).toBe(ids.memberA);
    const [lead] = await pg.select().from(leads).where(eq(leads.id, outcome.leadId));
    expect(lead).toMatchObject({
      inflowSource: 'member_referral',
      referrerName: 'テスト memberA',
      agencyName: null,
    });
    const after = await callers.memberA.prospects.myReferralLink({ organizationId });
    expect(after.leads).toBe(1);
    const [link] = await pg.select().from(agencyLinks).where(eq(agencyLinks.memberUserId, ids.memberA));
    expect(link?.kind).toBe('member_referral');
  });

  it('tells sales once when a row is handed over, and lists it as waiting', async () => {
    const before = await pg.select().from(notifications).where(eq(notifications.userId, ids.sales));
    const { id } = await callers.memberB.prospects.create({
      organizationId,
      ...base,
      company: '引き継ぎ商事',
      nextStep: 'hand_over',
      targetSystem: 'as400',
      troubles: ['no_documents', 'no_documents', 'few_maintainers'],
    });
    const row = await rowOf(id);
    expect(row.handedOverAt).not.toBeNull();
    expect(row.troubles).toEqual(['no_documents', 'few_maintainers']);
    await callers.memberB.prospects.update({
      organizationId,
      id,
      ...base,
      company: '引き継ぎ商事',
      nextStep: 'hand_over',
      heard: '追記',
    });
    const after = await pg.select().from(notifications).where(eq(notifications.userId, ids.sales));
    const notices = after.filter((n) => !before.some((b) => b.id === n.id));
    expect(notices.map((n) => n.type)).toEqual(['prospect_handed_over']);

    const waiting = await callers.sales.prospects.list({ organizationId, filter: 'handed_over' });
    expect(waiting.prospects.map((p: { company: string }) => p.company)).toContain('引き継ぎ商事');
  });

  it('finds rows of the same company written differently', async () => {
    await callers.memberA.prospects.create({ organizationId, ...base, company: '株式会社サンプル製作所' });
    const similar = await callers.memberB.prospects.similar({
      organizationId,
      company: 'ｻﾝﾌﾟﾙ製作所',
    });
    expect(similar.map((s: { company: string }) => s.company)).toContain('株式会社サンプル製作所');
  });

  it('links to an existing lead of the same email, and keeps what was heard as a note', async () => {
    const email = `same-${unique()}@example.co.jp`;
    const [existing] = await pg
      .insert(leads)
      .values({ organizationId, email, company: '既存株式会社', status: 'negotiating', inflowSource: 'lp_organic' })
      .returning();
    const make = async (who: 'memberA' | 'memberB') =>
      (
        await callers[who].prospects.create({
          organizationId,
          ...base,
          company: '既存株式会社',
          heard: `${who} が聞いた話`,
          targetSystem: 'acos',
        })
      ).id as string;
    const first = await make('memberA');
    const second = await make('memberB');

    for (const id of [first, second]) {
      const result = await callers.sales.prospects.convertToLead({
        organizationId,
        id,
        email: email.toUpperCase(),
      });
      expect(result).toEqual({ leadId: existing.id, linkedExisting: true });
    }
    const [lead] = await pg.select().from(leads).where(eq(leads.id, existing.id));
    expect(lead).toMatchObject({ status: 'negotiating', inflowSource: 'lp_organic' });
    const notes = await pg.select().from(leadComments).where(eq(leadComments.leadId, existing.id));
    expect(notes).toHaveLength(2);
    expect(notes[0]?.content).toContain('対象システム: acos');

    const linked = await callers.sales.prospects.forLead({ organizationId, leadId: existing.id });
    expect(linked.map((row: { heard: string }) => row.heard).sort()).toEqual([
      'memberA が聞いた話',
      'memberB が聞いた話',
    ]);

    // From now on the lead is followed: the member who wrote the row cannot change or delete it
    await expect(
      callers.memberA.prospects.update({ organizationId, id: first, ...base, company: '書き換え' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(callers.memberA.prospects.delete({ organizationId, id: first })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const list = await callers.memberA.prospects.list({ organizationId });
    const shown = list.prospects.find((row: { id: string }) => row.id === first);
    expect(shown).toMatchObject({ canEdit: false, lead: { id: existing.id, status: 'negotiating' } });
  });

  it('creates a new lead with the referrer and the system, and keeps the stage it had', async () => {
    const { id } = await callers.memberA.prospects.create({
      organizationId,
      ...base,
      entry: 'member_network',
      company: '新規リード工業',
      targetSystem: 'access',
    });
    await callers.sales.prospects.update({
      organizationId,
      id,
      ...base,
      entry: 'member_network',
      company: '新規リード工業',
      targetSystem: 'access',
      stage: 'quick_diagnosis',
    });
    const { leadId } = await callers.sales.prospects.convertToLead({
      organizationId,
      id,
      email: `new-${unique()}@example.co.jp`,
    });
    const [lead] = await pg.select().from(leads).where(eq(leads.id, leadId));
    expect(lead).toMatchObject({
      inflowSource: 'member_referral',
      referrerName: 'テスト memberA',
      targetSystem: 'access',
      company: '新規リード工業',
    });
    await callers.sales.prospects.update({
      organizationId,
      id,
      ...base,
      entry: 'member_network',
      company: '新規リード工業',
      stage: 'contract',
    });
    expect((await rowOf(id)).stage).toBe('quick_diagnosis');
  });
});
