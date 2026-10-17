/**
 * Appointment reviews (#149) on a real PostgreSQL: the conditions and deadline taken from the
 * agency contract, a review recorded after the deadline marked "late" for good, who may record,
 * the morning notice of reviews due (once, to the lead's assignee or else whoever recorded the
 * first hearing, respecting the member's setting) and the share of appointments meeting the
 * conditions in the contract report. All names are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/appointment-reviews.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  agencyContracts,
  appointmentReviews,
  leadHearings,
  leads,
  notificationPreferences,
  notifications,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { getAgencyContractReport } from '@/lib/features/agency-contracts/service';
import {
  runAppointmentReviewNotices,
  saveAppointmentReview,
} from '@/lib/features/appointment-reviews/service';
import { appRouter } from '@/server/routers/_app';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

/** 08:00 JST on Friday 2031-03-14, far from the real day so other tests do not interfere */
const RUN_AT = new Date('2031-03-13T23:00:00Z');
const AGENCY = 'アポ確認テスト代行';
const CRITERIA = ['決裁者が同席した', '対象の機種を確認できた'];

describe.skipIf(!url)('appointment reviews (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 4 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgIds: string[] = [];
  const userIds: string[] = [];
  let org: string;
  let otherOrg: string;
  const member: Record<'rep' | 'owner' | 'quiet' | 'viewer', { id: string }> = {} as never;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const callers: Record<'rep' | 'viewer', any> = {} as never;
  const lead: Record<string, string> = {};
  const sendEmail = vi.fn().mockResolvedValue({ id: 'mail' });

  async function createLead(
    key: string,
    values: { agencyName?: string | null; assigneeUserId?: string | null; organizationId?: string }
  ) {
    const [row] = await pg
      .insert(leads)
      .values({
        organizationId: values.organizationId ?? org,
        email: `review-${unique()}@example.co.jp`,
        name: '山田 花子',
        company: `架空商事${key}`,
        agencyName: values.agencyName === undefined ? AGENCY : values.agencyName,
        assigneeUserId: values.assigneeUserId ?? null,
        createdAt: new Date('2026-03-01T03:00:00Z'),
      })
      .returning();
    lead[key] = row.id;
    return row.id;
  }

  async function hearing(leadId: string, heldOn: string, createdBy: string) {
    await pg.insert(leadHearings).values({
      organizationId: org,
      leadId,
      heldOn,
      catalogVersion: 1,
      createdBy,
    });
  }

  beforeAll(async () => {
    for (const name of ['アポ確認テスト', 'アポ確認テスト別組織']) {
      const [row] = await pg
        .insert(organizations)
        .values({ name, slug: `review-${unique()}` })
        .returning();
      orgIds.push(row.id);
    }
    [org, otherOrg] = orgIds;
    for (const [key, role] of [
      ['rep', 'member'],
      ['owner', 'member'],
      ['quiet', 'member'],
      ['viewer', 'parent_viewer'],
    ] as const) {
      const [user] = await pg
        .insert(users)
        .values({ email: `review-${key}-${unique()}@example.com`, name: key })
        .returning();
      userIds.push(user.id);
      member[key] = user;
      await pg.insert(organizationMembers).values({ organizationId: org, userId: user.id, role });
      if (key === 'rep' || key === 'viewer') {
        callers[key] = appRouter.createCaller({
          db: pg,
          session: { session: { id: 's', userId: user.id }, user },
          user,
          // biome-ignore lint/suspicious/noExplicitAny: test context
        } as any);
      }
    }
    await pg.insert(notificationPreferences).values({
      userId: member.quiet.id,
      organizationId: org,
      inAppNextActionDue: false,
    });
    await pg.insert(agencyContracts).values({
      organizationId: org,
      agencyName: AGENCY,
      startsOn: '2026-01-01',
      feePerAppointment: 10_000,
      appointmentCriteria: CRITERIA,
      returnDeadlineBusinessDays: 1,
    });

    // Due today (Thu meeting → Fri), to the lead's assignee
    await hearing(await createLead('dueToday', { assigneeUserId: member.owner.id }), '2031-03-13', member.rep.id);
    // Due Monday (Fri meeting), no assignee: to whoever recorded the first hearing
    const dueMonday = await createLead('dueMonday', {});
    await hearing(dueMonday, '2031-03-14', member.rep.id);
    // A later hearing does not move the first meeting
    await hearing(dueMonday, '2031-03-20', member.owner.id);
    // Passed (Mon meeting → Tue), reviewed already, no contract, setting off, no agency
    await hearing(await createLead('passed', {}), '2031-03-10', member.rep.id);
    await hearing(await createLead('reviewed', {}), '2031-03-13', member.rep.id);
    await hearing(await createLead('otherAgency', { agencyName: '契約のない代行' }), '2031-03-13', member.rep.id);
    await hearing(await createLead('quiet', { assigneeUserId: member.quiet.id }), '2031-03-13', member.rep.id);
    await createLead('direct', { agencyName: null });
    await createLead('foreign', { organizationId: otherOrg });
  });

  afterAll(async () => {
    for (const id of orgIds) await pg.delete(organizations).where(eq(organizations.id, id));
    if (userIds.length) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it('gives the conditions, the deadline rule and the first meeting of an agency lead', async () => {
    const context = await callers.rep.appointmentReviews.get({ organizationId: org, leadId: lead.dueMonday });
    expect(context).toMatchObject({
      applicable: true,
      agencyName: AGENCY,
      rule: { criteria: CRITERIA, returnDeadlineBusinessDays: 1 },
      firstMeetingOn: '2031-03-14',
      review: null,
      canEdit: true,
    });
    // The fees of the contract are not part of it
    expect(JSON.stringify(context)).not.toContain('10000');

    expect(
      await callers.rep.appointmentReviews.get({ organizationId: org, leadId: lead.direct })
    ).toMatchObject({ applicable: false });
    expect(
      await callers.rep.appointmentReviews.get({ organizationId: org, leadId: lead.otherAgency })
    ).toMatchObject({ rule: { contractId: null, criteria: [], returnDeadlineBusinessDays: null } });
    await expect(
      callers.rep.appointmentReviews.get({ organizationId: org, leadId: lead.foreign })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('records a review; a met appointment keeps no reason or claim', async () => {
    const saved = await callers.rep.appointmentReviews.save({
      organizationId: org,
      leadId: lead.reviewed,
      meetingOn: '2031-03-13',
      checks: CRITERIA.map((label) => ({ label, met: true })),
      defectReason: '残してはいけない',
      claim: 'return',
    });
    expect(saved).toEqual({ conditionsMet: true, deadlineOn: '2031-03-14', recordedLate: false });
    const [row] = await pg.select().from(appointmentReviews).where(eq(appointmentReviews.leadId, lead.reviewed));
    expect(row).toMatchObject({ defectReason: null, claim: null, createdBy: member.rep.id });

    // Viewers from a parent organization read but do not record
    await expect(
      callers.viewer.appointmentReviews.save({
        organizationId: org,
        leadId: lead.reviewed,
        meetingOn: '2031-03-13',
        checks: [{ label: CRITERIA[0], met: false }],
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      callers.rep.appointmentReviews.save({
        organizationId: org,
        leadId: lead.direct,
        meetingOn: '2031-03-13',
        checks: [{ label: CRITERIA[0], met: false }],
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('marks a review first recorded after the deadline as late, even once corrected', async () => {
    const input = {
      organizationId: org,
      leadId: lead.passed,
      userId: member.rep.id,
      meetingOn: '2031-03-10',
      checks: [
        { label: CRITERIA[0], met: false },
        { label: CRITERIA[1], met: true },
      ],
      defectReason: '決裁者が欠席',
      claim: 'retake' as const,
    };
    // Deadline Tue 03-11; recorded Fri 03-14
    expect(await saveAppointmentReview(pg, input, RUN_AT)).toEqual({
      conditionsMet: false,
      deadlineOn: '2031-03-11',
      recordedLate: true,
    });
    // A corrected meeting day moves the deadline, but the review stays "late"
    expect(await saveAppointmentReview(pg, { ...input, meetingOn: '2031-03-13' }, RUN_AT)).toEqual({
      conditionsMet: false,
      deadlineOn: '2031-03-14',
      recordedLate: true,
    });
    const context = await callers.rep.appointmentReviews.get({ organizationId: org, leadId: lead.passed });
    expect(context.review).toMatchObject({ claim: 'retake', defectReason: '決裁者が欠席', recordedLate: true });
  });

  it('notifies unreviewed appointments due by the next business day, once', async () => {
    const run = () =>
      runAppointmentReviewNotices(pg, {
        now: RUN_AT,
        deps: { sendEmail, emailEnabled: () => true, appUrl: 'https://app.example.com' },
      });
    await run();
    const sent = await pg
      .select({ userId: notifications.userId, title: notifications.title, data: notifications.data })
      .from(notifications)
      .where(and(eq(notifications.organizationId, org), eq(notifications.type, 'appointment_review_due')));
    const byLead = Object.fromEntries(
      sent.map((row) => [(row.data as { leadId: string }).leadId, row])
    );
    expect(Object.keys(byLead).sort()).toEqual([lead.dueMonday, lead.dueToday].sort());
    expect(byLead[lead.dueToday]).toMatchObject({ userId: member.owner.id });
    expect(byLead[lead.dueToday].title).toContain('今日が期限');
    expect(byLead[lead.dueMonday]).toMatchObject({ userId: member.rep.id });
    expect(byLead[lead.dueMonday].title).toContain('3月17日が期限');
    expect(sendEmail).toHaveBeenCalledTimes(2);

    // Running again the same day sends nothing new
    await run();
    const again = await pg
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.organizationId, org), eq(notifications.type, 'appointment_review_due')));
    expect(again).toHaveLength(2);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('adds the share of appointments meeting the conditions to the contract report', async () => {
    const report = await getAgencyContractReport(pg, org, RUN_AT);
    const row = report.contracts.find((r) => r.contract.agencyName === AGENCY);
    // reviewed: met; passed: not met
    expect(row?.reviews).toEqual({ reviewed: 2, met: 1, metRate: 50 });
  });
});
