/**
 * First meeting preferences and their confirmation (#155) on a real PostgreSQL: saving and
 * replacing the preferences until one is confirmed, the confirmed date as the lead's next
 * meeting and a next action (moved when another option is confirmed), the confirmation email,
 * and who may confirm. All names are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/meeting-requests.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  leadTasks,
  leads,
  meetingRequests,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { getWeekMeetings } from '@/lib/features/leads/meetings';
import {
  acceptMeetingPreferences,
  confirmMeeting,
  saveMeetingPreferences,
} from '@/lib/features/meeting-requests/service';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

/** Friday 2026-10-16, 10:00 JST */
const NOW = new Date('2026-10-16T01:00:00Z');
const OPTIONS = [
  { date: '2026-10-21', time: '10:00' },
  { date: '2026-10-20', time: '14:00' },
];

describe.skipIf(!url)('meeting requests (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let org: string;
  const userIds: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const callers: Record<'rep' | 'viewer', any> = {} as never;
  let repId: string;

  async function createLead() {
    const [lead] = await pg
      .insert(leads)
      .values({
        organizationId: org,
        email: `meeting-${unique()}@example.co.jp`,
        name: '山田 花子',
        company: '架空商事',
      })
      .returning();
    return lead.id as string;
  }

  const save = (leadId: string, candidates = OPTIONS, now = NOW) =>
    saveMeetingPreferences(
      pg,
      {
        organizationId: org,
        leadId,
        submissionId: null,
        preferences: { candidates, attendeeRoles: ['executive', 'it_staff'], meetingFormat: 'online' },
      },
      now
    );

  /** The lead's next meeting as the dashboard reads it (week of 2026-10-19 to 10-25) */
  const nextMeetingOf = async (leadId: string) => {
    const week = await getWeekMeetings(pg, org, new Date('2026-10-20T03:00:00Z'));
    return week.items.find((item) => item.leadId === leadId)?.nextMeetingDate ?? null;
  };

  beforeAll(async () => {
    const [row] = await pg
      .insert(organizations)
      .values({ name: '架空システムズ', slug: `meeting-${unique()}` })
      .returning();
    org = row.id;
    for (const [key, role] of [
      ['rep', 'member'],
      ['viewer', 'parent_viewer'],
    ] as const) {
      const [user] = await pg
        .insert(users)
        .values({ email: `meeting-${key}-${unique()}@example.com`, name: '営業 太郎' })
        .returning();
      userIds.push(user.id);
      if (key === 'rep') repId = user.id;
      await pg.insert(organizationMembers).values({ organizationId: org, userId: user.id, role });
      callers[key] = appRouter.createCaller({
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

  it('saves the preferences, replaces them, and tells sales about the first ones only', async () => {
    const leadId = await createLead();
    const later = vi.fn();
    expect(await save(leadId)).toEqual({ status: 'saved', first: true });
    expect(await save(leadId, [{ date: '2026-10-22', time: '11:00' }])).toEqual({
      status: 'saved',
      first: false,
    });
    const view = await callers.rep.meetingRequests.get({ organizationId: org, leadId });
    expect(view.request).toMatchObject({
      candidates: [{ date: '2026-10-22', time: '11:00' }],
      attendeeRoles: ['executive', 'it_staff'],
      meetingFormat: 'online',
      confirmed: null,
    });

    // Out of range (today) is refused; a request without a lead is "unavailable"
    expect(await save(leadId, [{ date: '2026-10-16', time: '11:00' }])).toEqual({
      status: 'out_of_range',
    });
    expect(
      await acceptMeetingPreferences(
        pg,
        {
          organizationId: org,
          leadId: null,
          submissionId: '00000000-0000-4000-8000-000000000000',
          identityVerified: true,
          preferences: { candidates: OPTIONS, attendeeRoles: [], meetingFormat: null },
        },
        later,
        NOW
      )
    ).toBe('unavailable');

    // An answer tied to the lead by email only never changes it, even before a confirmation
    expect(
      await acceptMeetingPreferences(
        pg,
        {
          organizationId: org,
          leadId,
          submissionId: '00000000-0000-4000-8000-000000000000',
          identityVerified: false,
          preferences: {
            candidates: [{ date: '2026-10-30', time: '16:00' }],
            attendeeRoles: [],
            meetingFormat: null,
          },
        },
        later,
        NOW
      )
    ).toBe('unavailable');
    const after = await callers.rep.meetingRequests.get({ organizationId: org, leadId });
    expect(after.request.candidates).toEqual([{ date: '2026-10-22', time: '11:00' }]);
    expect(later).not.toHaveBeenCalled();
  });

  it('confirms an option as the next meeting and a next action, and moves them on a change', async () => {
    const leadId = await createLead();
    await save(leadId);
    expect(await nextMeetingOf(leadId)).toBeNull();

    // Stored earliest first: index 0 is 10-20 14:00
    const first = await callers.rep.meetingRequests.confirm({
      organizationId: org,
      leadId,
      candidateIndex: 0,
      sendEmail: false,
    });
    expect(first).toMatchObject({ ok: true, candidate: OPTIONS[1], email: 'not_requested' });
    expect(await nextMeetingOf(leadId)).toBe('2026-10-20');
    let tasks = await pg.select().from(leadTasks).where(eq(leadTasks.leadId, leadId));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      source: 'meeting_request',
      dueOn: '2026-10-20',
      title: '初回商談（オンライン） 14:00〜',
    });

    // Locked once confirmed: the respondent cannot replace the preferences
    expect(await save(leadId, [{ date: '2026-10-30', time: '10:00' }])).toEqual({
      status: 'confirmed',
    });

    await callers.rep.meetingRequests.confirm({
      organizationId: org,
      leadId,
      candidateIndex: 1,
      sendEmail: false,
    });
    expect(await nextMeetingOf(leadId)).toBe('2026-10-21');
    tasks = await pg.select().from(leadTasks).where(eq(leadTasks.leadId, leadId));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ dueOn: '2026-10-21', title: '初回商談（オンライン） 10:00〜' });

    const view = await callers.rep.meetingRequests.get({ organizationId: org, leadId });
    expect(view.request.confirmed).toMatchObject({ date: '2026-10-21', time: '10:00', byName: '営業 太郎' });
    expect(view.request.confirmationEmailedAt).toBeNull();
  });

  it('emails the respondent when email is available', async () => {
    const leadId = await createLead();
    await save(leadId);
    const sendEmail = vi.fn().mockResolvedValue({ id: 'mail' });
    const outcome = await confirmMeeting(
      pg,
      { organizationId: org, leadId, candidateIndex: 0, sendEmail: true, userId: repId },
      { now: NOW, deps: { sendEmail, emailEnabled: () => true } }
    );
    expect(outcome).toMatchObject({ ok: true, email: 'sent' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].text).toContain('日時：10月20日（火）14:00〜');
    const [row] = await pg
      .select({ emailedAt: meetingRequests.confirmationEmailedAt })
      .from(meetingRequests)
      .where(eq(meetingRequests.leadId, leadId));
    expect(row.emailedAt).not.toBeNull();

    // Without an email provider nothing is sent, and the meeting is still confirmed
    const other = await createLead();
    await save(other);
    expect(
      await confirmMeeting(
        pg,
        { organizationId: org, leadId: other, candidateIndex: 1, sendEmail: true, userId: repId },
        { now: NOW, deps: { sendEmail, emailEnabled: () => false } }
      )
    ).toMatchObject({ ok: true, email: 'not_configured' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(await nextMeetingOf(other)).toBe('2026-10-21');
  });

  it('lets parent viewers read but not confirm, and hides other leads', async () => {
    const leadId = await createLead();
    await save(leadId);
    expect(
      (await callers.viewer.meetingRequests.get({ organizationId: org, leadId })).canEdit
    ).toBe(false);
    await expect(
      callers.viewer.meetingRequests.confirm({ organizationId: org, leadId, candidateIndex: 0 })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const without = await createLead();
    expect((await callers.rep.meetingRequests.get({ organizationId: org, leadId: without })).request).toBeNull();
    await expect(
      callers.rep.meetingRequests.confirm({ organizationId: org, leadId: without, candidateIndex: 0 })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
