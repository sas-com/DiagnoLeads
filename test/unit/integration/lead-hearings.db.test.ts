/**
 * Lead hearings (#84) through the leadHearings router on a real PostgreSQL: prefill from the
 * diagnosis, organization isolation, carry-over, optimistic concurrency, the per-lead limit
 * and the cascade from the lead.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/lead-hearings.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  diagnosticSubmissions,
  leadHearings,
  leads,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { createLeadHearing } from '@/lib/features/lead-hearings/service';
import { appRouter } from '@/server/routers/_app';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('lead hearings (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  let orgA: string;
  let orgB: string;
  let userA: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let adminA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let viewerA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let adminB: any;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `hearing-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string, role: schema.OrganizationRole) {
    const [user] = await pg
      .insert(users)
      .values({ email: `hearing-${unique()}@example.com`, name: 'テスト 太郎' })
      .returning();
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    const caller = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
    return { caller, userId: user.id };
  }

  async function createLead(organizationId: string) {
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId, email: `lead-${unique()}@example.co.jp`, name: '山田 花子' })
      .returning();
    return lead.id;
  }

  async function createSubmission(
    organizationId: string,
    leadId: string,
    answers: Record<string, string | string[]>,
    options: { leadCreated: boolean; createdAt: Date }
  ) {
    const [row] = await pg
      .insert(diagnosticSubmissions)
      .values({
        organizationId,
        leadId,
        leadCreated: options.leadCreated,
        diagnosticKey: 'ax-migration',
        diagnosticVersion: 2,
        answers,
        result: { challenges: { primary: 'people', selected: ['people'] } },
        createdAt: options.createdAt,
      })
      .returning();
    return row.id;
  }

  beforeAll(async () => {
    orgA = await createOrganization('ヒアリングテストA株式会社');
    orgB = await createOrganization('ヒアリングテストB株式会社');
    const a = await callerFor(orgA, 'admin');
    adminA = a.caller;
    userA = a.userId;
    viewerA = (await callerFor(orgA, 'parent_viewer')).caller;
    adminB = (await callerFor(orgB, 'admin')).caller;
  });

  afterAll(async () => {
    for (const id of organizationIds) {
      await pg.delete(organizations).where(eq(organizations.id, id));
    }
    await client?.end();
  });

  it('prefills from the newest submission and flags it as unverified when needed', async () => {
    const leadId = await createLead(orgA);
    const older = await createSubmission(
      orgA,
      leadId,
      { platform: 'as400', timeline: 'within_1y' },
      { leadCreated: true, createdAt: new Date('2026-09-01T00:00:00Z') }
    );
    const newer = await createSubmission(
      orgA,
      leadId,
      { platform: 'acos', acos_programs: '1000_2999', role: 'it_manager' },
      { leadCreated: false, createdAt: new Date('2026-10-01T00:00:00Z') }
    );

    const sources = await adminA.leadHearings.prefillSources({ organizationId: orgA, leadId });
    expect(sources.map((s: { id: string }) => s.id)).toEqual([newer, older]);
    expect(sources[0]).toMatchObject({ platform: 'acos', verified: false });

    const hearing = await adminA.leadHearings.create({
      organizationId: orgA,
      leadId,
      heldOn: '2026-10-16',
    });
    expect(hearing.prefill).toMatchObject({ submissionId: newer, verified: false });
    expect(hearing.fields.targetSystem).toEqual({
      value: 'acos',
      status: 'not_yet',
      source: 'prefilled',
    });
    expect(hearing.fields.scale.value).toEqual({ basis: 'acos_programs', bucket: '1000_2999' });
    expect(hearing.missing.unconfirmed).toContain('system');
    expect(hearing.createdBy).toBe(userA);

    // Choosing the older (verified) submission explicitly
    const chosen = await adminA.leadHearings.create({
      organizationId: orgA,
      leadId,
      heldOn: '2026-10-17',
      submissionId: older,
      carryOver: false,
    });
    expect(chosen.prefill).toMatchObject({ submissionId: older, verified: true });
    expect(chosen.fields.targetSystem.value).toBe('as400');
    expect(chosen.fields.directionTiming.value).toBe('within_1y');
  });

  it('rejects a submission of another lead or another organization', async () => {
    const leadId = await createLead(orgA);
    const otherLead = await createLead(orgA);
    const ofOtherLead = await createSubmission(
      orgA,
      otherLead,
      { platform: 'access' },
      { leadCreated: true, createdAt: new Date() }
    );
    // A row of organization B that points at A's lead
    const ofOtherOrg = await createSubmission(
      orgB,
      leadId,
      { platform: 'access' },
      { leadCreated: true, createdAt: new Date() }
    );

    for (const submissionId of [ofOtherLead, ofOtherOrg]) {
      await expect(
        adminA.leadHearings.create({
          organizationId: orgA,
          leadId,
          heldOn: '2026-10-16',
          submissionId,
        })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    // Nor is B's row used as the default source
    const hearing = await adminA.leadHearings.create({
      organizationId: orgA,
      leadId,
      heldOn: '2026-10-16',
    });
    expect(hearing.prefill).toBeNull();
    expect(hearing.fields).toEqual({});
  });

  it('keeps hearings inside their organization', async () => {
    const leadId = await createLead(orgA);
    const hearing = await adminA.leadHearings.create({
      organizationId: orgA,
      leadId,
      heldOn: '2026-10-16',
    });
    const stranger = { organizationId: orgB, id: hearing.id };

    await expect(adminB.leadHearings.get(stranger)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.leadHearings.update({
        ...stranger,
        heldOn: '2026-10-18',
        fields: {},
        expectedUpdatedAt: hearing.updatedAt,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(adminB.leadHearings.delete(stranger)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      adminB.leadHearings.listByLead({ organizationId: orgB, leadId })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.leadHearings.create({ organizationId: orgB, leadId, heldOn: '2026-10-16' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // B is not a member of A
    await expect(
      adminB.leadHearings.get({ organizationId: orgA, id: hearing.id })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const [row] = await pg.select().from(leadHearings).where(eq(leadHearings.id, hearing.id));
    expect(row.heldOn).toBe('2026-10-16');
    expect(await pg.select().from(leadHearings).where(eq(leadHearings.leadId, leadId))).toHaveLength(
      1
    );
  });

  it('lets a parent viewer read but not write', async () => {
    const leadId = await createLead(orgA);
    const hearing = await adminA.leadHearings.create({
      organizationId: orgA,
      leadId,
      heldOn: '2026-10-16',
    });

    const read = await viewerA.leadHearings.get({ organizationId: orgA, id: hearing.id });
    expect(read.canEdit).toBe(false);
    await expect(
      viewerA.leadHearings.update({
        organizationId: orgA,
        id: hearing.id,
        heldOn: '2026-10-16',
        fields: {},
        expectedUpdatedAt: hearing.updatedAt,
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      viewerA.leadHearings.create({ organizationId: orgA, leadId, heldOn: '2026-10-16' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('carries the latest hearing over to the next one, and saves with a fresh updatedAt only', async () => {
    const leadId = await createLead(orgA);
    await createSubmission(
      orgA,
      leadId,
      { platform: 'as400' },
      { leadCreated: true, createdAt: new Date() }
    );
    const first = await adminA.leadHearings.create({
      organizationId: orgA,
      leadId,
      heldOn: '2026-10-01',
    });
    const fields = {
      targetSystem: { value: 'as400', status: 'done', source: 'confirmed' },
      dealRating: { value: 'b', status: 'done', source: null },
      nextMeetingDate: { status: 'next', source: null },
    };
    const saved = await adminA.leadHearings.update({
      organizationId: orgA,
      id: first.id,
      heldOn: '2026-10-01',
      fields,
      expectedUpdatedAt: first.updatedAt,
    });
    expect(saved.fields).toEqual(fields);
    expect(saved.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());

    // A second save based on the stale read fails and leaves the row alone
    await expect(
      adminA.leadHearings.update({
        organizationId: orgA,
        id: first.id,
        heldOn: '2026-10-02',
        fields: {},
        expectedUpdatedAt: first.updatedAt,
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const reread = await adminA.leadHearings.get({ organizationId: orgA, id: first.id });
    expect(reread.fields).toEqual(fields);
    expect(reread.heldOn).toBe('2026-10-01');

    const second = await adminA.leadHearings.create({
      organizationId: orgA,
      leadId,
      heldOn: '2026-10-15',
    });
    expect(second.fields).toEqual(fields);
    expect(second.prefill).toEqual(first.prefill);

    // carryOver: false starts again from the diagnosis
    const fresh = await adminA.leadHearings.create({
      organizationId: orgA,
      leadId,
      heldOn: '2026-10-16',
      carryOver: false,
    });
    expect(fresh.fields.targetSystem).toEqual({
      value: 'as400',
      status: 'not_yet',
      source: 'prefilled',
    });
    expect(fresh.fields.dealRating).toBeUndefined();

    const list = await adminA.leadHearings.listByLead({ organizationId: orgA, leadId });
    expect(list.items.map((i: { heldOn: string }) => i.heldOn)).toEqual([
      '2026-10-16',
      '2026-10-15',
      '2026-10-01',
    ]);
    // All three started from (or carried over) the diagnosis snapshot
    expect(list.items.map((i: { fromDiagnosis: boolean }) => i.fromDiagnosis)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('stops at the limit of hearings per lead', async () => {
    const leadId = await createLead(orgA);
    const input = { organizationId: orgA, leadId, heldOn: '2026-10-16', userId: userA };
    await createLeadHearing(pg, input, { maxPerLead: 2 });
    await createLeadHearing(pg, input, { maxPerLead: 2 });
    await expect(createLeadHearing(pg, input, { maxPerLead: 2 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(await pg.select().from(leadHearings).where(eq(leadHearings.leadId, leadId))).toHaveLength(
      2
    );
  });

  it('deletes a hearing, and all hearings with their lead', async () => {
    const leadId = await createLead(orgA);
    const one = await adminA.leadHearings.create({
      organizationId: orgA,
      leadId,
      heldOn: '2026-10-16',
    });
    await adminA.leadHearings.create({ organizationId: orgA, leadId, heldOn: '2026-10-17' });
    await adminA.leadHearings.create({ organizationId: orgA, leadId, heldOn: '2026-10-18' });

    await expect(
      adminA.leadHearings.delete({ organizationId: orgA, id: one.id })
    ).resolves.toEqual({ id: one.id });
    expect(await pg.select().from(leadHearings).where(eq(leadHearings.leadId, leadId))).toHaveLength(
      2
    );

    await pg.delete(leads).where(eq(leads.id, leadId));
    expect(await pg.select().from(leadHearings).where(eq(leadHearings.leadId, leadId))).toHaveLength(
      0
    );
  });

  it('builds the summary against the hearing held just before it (#97)', async () => {
    const leadId = await createLead(orgA);
    await pg.update(leads).set({ company: 'まとめテスト株式会社' }).where(eq(leads.id, leadId));
    const otherLead = await createLead(orgA);
    const create = (lead: string, heldOn: string, now: string) =>
      createLeadHearing(
        pg,
        { organizationId: orgA, leadId: lead, heldOn, userId: userA, carryOver: false },
        { now: new Date(now) }
      );
    const setFields = (id: string, fields: Record<string, unknown>) =>
      pg.update(leadHearings).set({ fields }).where(eq(leadHearings.id, id));
    const budget = (value: string) => ({ budgetStatus: { value, status: 'done', source: null } });

    const first = await create(leadId, '2026-10-01', '2026-10-01T09:00:00Z');
    // Same day as `third` but created earlier; recorded after `third` was created
    const second = await create(leadId, '2026-10-10', '2026-10-10T09:00:00Z');
    const third = await create(leadId, '2026-10-10', '2026-10-10T10:00:00Z');
    // Later meeting and another lead's hearing: never the previous one
    const later = await create(leadId, '2026-10-20', '2026-10-05T09:00:00Z');
    const elsewhere = await create(otherLead, '2026-10-09', '2026-10-09T09:00:00Z');
    await setFields(first.id, budget('not_started'));
    await setFields(second.id, budget('planning'));
    await setFields(third.id, {
      ...budget('secured'),
      targetSystem: { value: 'as400', status: 'not_yet', source: 'prefilled' },
      hardwareSupportEnd: { status: 'next', source: null },
    });
    await setFields(later.id, budget('unknown'));
    await setFields(elsewhere.id, budget('unknown'));

    const summaryOf = (caller: typeof adminA, id: string) =>
      caller.leadHearings.summary({ organizationId: orgA, id });

    const ofThird = await summaryOf(adminA, third.id);
    expect(ofThird.previousId).toBe(second.id);
    expect(ofThird.summary.lead).toEqual({ name: '山田 花子', company: 'まとめテスト株式会社' });
    expect(ofThird.summary.previousHeldOn).toBe('2026-10-10');
    expect(ofThird.summary.changedSincePrevious).toEqual([
      { key: 'targetSystem', label: '対象システム', before: null, after: 'AS/400' },
      { key: 'budgetStatus', label: '予算の状態', before: '計画中', after: '確保済み' },
    ]);
    expect(ofThird.summary.unconfirmed.map((u: { key: string }) => u.key)).toEqual([
      'targetSystem',
    ]);
    expect(ofThird.summary.next.map((n: { key: string }) => n.key)).toEqual([
      'hardwareSupportEnd',
    ]);

    expect((await summaryOf(adminA, second.id)).previousId).toBe(first.id);
    expect((await summaryOf(adminA, later.id)).previousId).toBe(third.id);
    const ofFirst = await summaryOf(viewerA, first.id);
    expect(ofFirst.previousId).toBeNull();
    expect(ofFirst.summary.changedSincePrevious).toEqual([]);
    expect((await summaryOf(adminA, elsewhere.id)).previousId).toBeNull();

    // Same date and the same creation time: the id breaks the tie, so exactly one is previous
    const tiedLead = await createLead(orgA);
    const tiedA = await create(tiedLead, '2026-10-25', '2026-10-25T09:00:00Z');
    const tiedB = await create(tiedLead, '2026-10-25', '2026-10-25T09:00:00Z');
    const [low, high] = [tiedA.id, tiedB.id].sort();
    expect((await summaryOf(adminA, high)).previousId).toBe(low);
    expect((await summaryOf(adminA, low)).previousId).toBeNull();

    await expect(
      adminB.leadHearings.summary({ organizationId: orgB, id: third.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
