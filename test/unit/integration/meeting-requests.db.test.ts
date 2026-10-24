/**
 * First meeting preferences and their confirmation (#155) on a real PostgreSQL: saving and
 * replacing the preferences until one is confirmed, the confirmed date as the lead's next
 * meeting and a next action (moved when another option is confirmed), the confirmation email,
 * who may confirm, and the topics and the note of #244; the preferences of unverified answers,
 * kept but never replacing verified ones (#274). All names are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/meeting-requests.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  diagnosticSubmissions,
  leadTasks,
  leads,
  meetingRequests,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { getWeekMeetings } from '@/lib/features/leads/meetings';
import {
  MEETING_PREFERENCES_WINDOW_MS,
  acceptMeetingPreferences,
  confirmMeeting,
  saveMeetingPreferences,
} from '@/lib/features/meeting-requests/service';
import {
  type MeetingPreferences,
  meetingPreferencesSchema,
} from '@/lib/features/meeting-requests/types/schemas';
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
/** OPTIONS as stored and shown to sales: earliest first */
const STORED = [OPTIONS[1], OPTIONS[0]];

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

  const save = (
    leadId: string,
    candidates = OPTIONS,
    now = NOW,
    about: Pick<MeetingPreferences, 'topics' | 'topicNote'> = { topics: [], topicNote: null }
  ) =>
    saveMeetingPreferences(
      pg,
      {
        organizationId: org,
        leadId,
        submissionId: null,
        identityVerified: true,
        preferences: {
          candidates,
          attendeeRoles: ['executive', 'it_staff'],
          meetingFormat: 'online',
          ...about,
        },
      },
      now
    );

  /**
   * A diagnosis answer for the lead: 'created' made the lead, 'continued' came after one that
   * did (from the same result screen), 'email' matched it by the email address only
   */
  async function createSubmission(leadId: string, kind: 'created' | 'continued' | 'email') {
    const values = {
      organizationId: org,
      leadId,
      diagnosticKey: 'ax-migration',
      diagnosticVersion: 3,
      answers: {},
      result: {},
    };
    let continuedFromSubmissionId: string | null = null;
    if (kind === 'continued') {
      const [origin] = await pg
        .insert(diagnosticSubmissions)
        .values({ ...values, leadCreated: true })
        .returning({ id: diagnosticSubmissions.id });
      continuedFromSubmissionId = origin.id;
    }
    const [row] = await pg
      .insert(diagnosticSubmissions)
      .values({ ...values, leadCreated: kind === 'created', continuedFromSubmissionId })
      .returning({ id: diagnosticSubmissions.id });
    return row.id as string;
  }

  /**
   * The preferences sent with a consultation request, as the routes pass them; the consultation
   * was requested at NOW unless said otherwise
   */
  const accept = (
    leadId: string,
    submissionId: string,
    identityVerified: boolean,
    candidates: { date: string; time: string }[],
    later: (task: () => Promise<void>) => void = vi.fn(),
    { requestedAt = NOW, now = NOW }: { requestedAt?: Date; now?: Date } = {}
  ) =>
    acceptMeetingPreferences(
      pg,
      {
        organizationId: org,
        leadId,
        submissionId,
        identityVerified,
        requestedAt,
        preferences: {
          candidates,
          attendeeRoles: [],
          meetingFormat: null,
          topics: [],
          topicNote: null,
        },
      },
      later,
      now
    );

  /** What sales see on the lead page */
  const requestOf = async (leadId: string) =>
    (await callers.rep.meetingRequests.get({ organizationId: org, leadId })).request;

  const submissionOf = async (leadId: string) =>
    (
      await pg
        .select({ submissionId: meetingRequests.submissionId })
        .from(meetingRequests)
        .where(eq(meetingRequests.leadId, leadId))
    )[0]?.submissionId;

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
    expect(await save(leadId)).toEqual({ status: 'saved', first: true, replacedUnverified: false });
    expect(await save(leadId, [{ date: '2026-10-22', time: '11:00' }])).toEqual({
      status: 'saved',
      first: false,
      replacedUnverified: false,
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
          requestedAt: NOW,
          preferences: {
            candidates: OPTIONS,
            attendeeRoles: [],
            meetingFormat: null,
            topics: [],
            topicNote: null,
          },
        },
        later,
        NOW
      )
    ).toBe('unavailable');

    // An answer tied to the lead by email only never changes verified preferences (#274; these
    // have no answer, as before #274), even before a confirmation
    const emailOnly = await createSubmission(leadId, 'email');
    expect(
      await acceptMeetingPreferences(
        pg,
        {
          organizationId: org,
          leadId,
          submissionId: emailOnly,
          identityVerified: false,
          requestedAt: NOW,
          preferences: {
            candidates: [{ date: '2026-10-30', time: '16:00' }],
            attendeeRoles: [],
            meetingFormat: null,
            topics: ['cost'],
            topicNote: '書き換え',
          },
        },
        later,
        NOW
      )
    ).toBe('unavailable');
    const after = await callers.rep.meetingRequests.get({ organizationId: org, leadId });
    expect(after.request.candidates).toEqual([{ date: '2026-10-22', time: '11:00' }]);
    expect(after.request).toMatchObject({ topics: [], topicNote: null, identityVerified: true });
    expect(later).not.toHaveBeenCalled();
  });

  it('takes preferences for a day after the consultation request, then keeps them (#241)', async () => {
    const leadId = await createLead();
    const submissionId = await createSubmission(leadId, 'created');
    const later = vi.fn();
    const endOfWindow = new Date(NOW.getTime() + MEETING_PREFERENCES_WINDOW_MS);
    // Sent again at the very end of the day after the request: replaced
    expect(await accept(leadId, submissionId, true, OPTIONS, later)).toBe('saved');
    expect(
      await accept(leadId, submissionId, true, [OPTIONS[0]], later, { now: endOfWindow })
    ).toBe('saved');
    // A moment later the same answer changes nothing, before a confirmation as well
    expect(
      await accept(leadId, submissionId, true, [{ date: '2026-10-22', time: '11:00' }], later, {
        now: new Date(endOfWindow.getTime() + 1),
      })
    ).toBe('unavailable');
    expect((await requestOf(leadId)).candidates).toEqual([OPTIONS[0]]);
    // Only the first preferences told sales
    expect(later).toHaveBeenCalledTimes(1);

    // A week later the person answers again. Only one answer creates a lead, so this one is tied
    // to it by the email address only (unverified). Its consultation request opens a new day,
    // but the verified preferences above are kept (#274)
    const nextWeek = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
    const again = await createSubmission(leadId, 'email');
    expect(
      await accept(leadId, again, false, [{ date: '2026-10-29', time: '11:00' }], later, {
        requestedAt: nextWeek,
        now: nextWeek,
      })
    ).toBe('unavailable');
    expect((await requestOf(leadId)).candidates).toEqual([OPTIONS[0]]);
    expect(later).toHaveBeenCalledTimes(1);

    // A lead without preferences takes those of the new day
    const quietLead = await createLead();
    await createSubmission(quietLead, 'created');
    const answeredAgain = await createSubmission(quietLead, 'email');
    expect(
      await accept(quietLead, answeredAgain, false, [{ date: '2026-10-29', time: '11:00' }], later, {
        requestedAt: nextWeek,
        now: nextWeek,
      })
    ).toBe('saved');
    expect(await requestOf(quietLead)).toMatchObject({
      candidates: [{ date: '2026-10-29', time: '11:00' }],
      identityVerified: false,
    });
    expect(later).toHaveBeenCalledTimes(2);
  });

  it('keeps the preferences of an unverified answer, replaced only by later ones (#274)', async () => {
    const leadId = await createLead();
    const later = vi.fn();
    const first = await createSubmission(leadId, 'email');
    expect(await accept(leadId, first, false, OPTIONS, later)).toBe('saved');
    // Sales are told about the first ones
    expect(later).toHaveBeenCalledTimes(1);
    expect(await requestOf(leadId)).toMatchObject({
      candidates: [OPTIONS[1], OPTIONS[0]],
      identityVerified: false,
    });
    expect(await submissionOf(leadId)).toBe(first);

    // Another unverified answer replaces them, without another notice
    const second = await createSubmission(leadId, 'email');
    expect(await accept(leadId, second, false, [{ date: '2026-10-22', time: '11:00' }], later)).toBe(
      'saved'
    );
    expect(later).toHaveBeenCalledTimes(1);
    expect(await requestOf(leadId)).toMatchObject({
      candidates: [{ date: '2026-10-22', time: '11:00' }],
      identityVerified: false,
    });
    expect(await submissionOf(leadId)).toBe(second);
  });

  it('lets a verified answer replace unverified preferences, never the other way (#274)', async () => {
    const leadId = await createLead();
    await accept(leadId, await createSubmission(leadId, 'email'), false, OPTIONS);

    const created = await createSubmission(leadId, 'created');
    expect(await accept(leadId, created, true, [{ date: '2026-10-22', time: '11:00' }])).toBe(
      'saved'
    );
    expect(await requestOf(leadId)).toMatchObject({
      candidates: [{ date: '2026-10-22', time: '11:00' }],
      identityVerified: true,
    });

    // An unverified answer leaves them as they are: the form shows the friendly message
    const later = vi.fn();
    expect(
      await accept(leadId, await createSubmission(leadId, 'email'), false, OPTIONS, later)
    ).toBe('unavailable');
    expect(later).not.toHaveBeenCalled();
    expect(await requestOf(leadId)).toMatchObject({
      candidates: [{ date: '2026-10-22', time: '11:00' }],
      identityVerified: true,
    });
    expect(await submissionOf(leadId)).toBe(created);
  });

  it('derives whether a request is verified from its answer (#274)', async () => {
    // Continuing an answer that created the lead counts as verified
    const continuedLead = await createLead();
    const continued = await createSubmission(continuedLead, 'continued');
    await accept(continuedLead, continued, true, OPTIONS);
    expect((await requestOf(continuedLead)).identityVerified).toBe(true);
    expect(
      await accept(continuedLead, await createSubmission(continuedLead, 'email'), false, OPTIONS)
    ).toBe('unavailable');

    // A request whose answer was deleted (set null) counts as verified
    const deletedLead = await createLead();
    const gone = await createSubmission(deletedLead, 'email');
    await accept(deletedLead, gone, false, OPTIONS);
    expect((await requestOf(deletedLead)).identityVerified).toBe(false);
    await pg.delete(diagnosticSubmissions).where(eq(diagnosticSubmissions.id, gone));
    expect(await submissionOf(deletedLead)).toBeNull();
    expect((await requestOf(deletedLead)).identityVerified).toBe(true);
    expect(
      await accept(deletedLead, await createSubmission(deletedLead, 'email'), false, OPTIONS)
    ).toBe('unavailable');
  });

  it('keeps a confirmed meeting whoever sends preferences again (#274)', async () => {
    // Unverified preferences, confirmed by sales
    const leadId = await createLead();
    await accept(leadId, await createSubmission(leadId, 'email'), false, OPTIONS);
    await callers.rep.meetingRequests.confirm({
      organizationId: org,
      leadId,
      candidateIndex: 0,
      candidate: STORED[0],
      sendEmail: false,
    });
    const later = vi.fn();
    expect(
      await accept(leadId, await createSubmission(leadId, 'email'), false, [{ date: '2026-10-22', time: '11:00' }], later)
    ).toBe('confirmed');
    // A verified answer does not replace a confirmed meeting either, even an unverified one
    expect(
      await accept(leadId, await createSubmission(leadId, 'created'), true, [{ date: '2026-10-22', time: '11:00' }], later)
    ).toBe('confirmed');
    expect(later).not.toHaveBeenCalled();
    expect(await requestOf(leadId)).toMatchObject({
      candidates: [OPTIONS[1], OPTIONS[0]],
      confirmed: { date: '2026-10-20', time: '14:00' },
      identityVerified: false,
    });

    // Verified preferences, confirmed: an unverified answer gets 'confirmed', not 'unavailable'
    const other = await createLead();
    await save(other);
    await callers.rep.meetingRequests.confirm({
      organizationId: org,
      leadId: other,
      candidateIndex: 0,
      candidate: STORED[0],
      sendEmail: false,
    });
    expect(await accept(other, await createSubmission(other, 'email'), false, OPTIONS)).toBe(
      'confirmed'
    );
  });

  it('stores the topics and the note, replaces them, and keeps them once confirmed (#244)', async () => {
    const leadId = await createLead();
    // The input as the routes parse it
    expect(
      await saveMeetingPreferences(
        pg,
        {
          organizationId: org,
          leadId,
          submissionId: null,
          identityVerified: true,
          preferences: meetingPreferencesSchema.parse({
            candidates: OPTIONS,
            topics: ['result_detail', 'internal_resources'],
            topicNote: '  <b>来期</b>の予算で\n進めたい  ',
          }),
        },
        NOW
      )
    ).toEqual({ status: 'saved', first: true, replacedUnverified: false });
    const [row] = await pg
      .select({ topics: meetingRequests.topics, topicNote: meetingRequests.topicNote })
      .from(meetingRequests)
      .where(eq(meetingRequests.leadId, leadId));
    expect(row).toEqual({
      topics: ['result_detail', 'internal_resources'],
      topicNote: '<b>来期</b>の予算で\n進めたい',
    });
    let view = await callers.rep.meetingRequests.get({ organizationId: org, leadId });
    expect(view.request).toMatchObject({
      topics: ['result_detail', 'internal_resources'],
      topicNote: '<b>来期</b>の予算で\n進めたい',
    });

    // Sent again: replaced, also back to none
    await save(leadId, OPTIONS, NOW, { topics: ['cost'], topicNote: null });
    view = await callers.rep.meetingRequests.get({ organizationId: org, leadId });
    expect(view.request).toMatchObject({ topics: ['cost'], topicNote: null });

    // Locked once confirmed
    await callers.rep.meetingRequests.confirm({
      organizationId: org,
      leadId,
      candidateIndex: 0,
      candidate: STORED[0],
      sendEmail: false,
    });
    expect(
      await save(leadId, OPTIONS, NOW, { topics: ['schedule'], topicNote: '変更' })
    ).toEqual({ status: 'confirmed' });
    view = await callers.rep.meetingRequests.get({ organizationId: org, leadId });
    expect(view.request).toMatchObject({ topics: ['cost'], topicNote: null });
  });

  it('defaults the topics of rows saved before #244 to none', async () => {
    const leadId = await createLead();
    await pg.insert(meetingRequests).values({ organizationId: org, leadId, candidates: OPTIONS });
    const view = await callers.rep.meetingRequests.get({ organizationId: org, leadId });
    expect(view.request).toMatchObject({ topics: [], topicNote: null });
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
      candidate: STORED[0],
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
      candidate: STORED[1],
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
      { organizationId: org, leadId, candidateIndex: 0, candidate: STORED[0], sendEmail: true, userId: repId },
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
        { organizationId: org, leadId: other, candidateIndex: 1, candidate: STORED[1], sendEmail: true, userId: repId },
        { now: NOW, deps: { sendEmail, emailEnabled: () => false } }
      )
    ).toMatchObject({ ok: true, email: 'not_configured' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(await nextMeetingOf(other)).toBe('2026-10-21');
  });

  it('confirms nothing when the preferences changed after sales loaded them (#274)', async () => {
    const leadId = await createLead();
    await accept(leadId, await createSubmission(leadId, 'email'), false, OPTIONS);
    // Sales see STORED; meanwhile another unverified answer replaces the options
    await accept(leadId, await createSubmission(leadId, 'email'), false, [
      { date: '2026-10-23', time: '15:00' },
      { date: '2026-10-22', time: '11:00' },
    ]);
    const sendEmail = vi.fn().mockResolvedValue({ id: 'mail' });
    expect(
      await confirmMeeting(
        pg,
        {
          organizationId: org,
          leadId,
          candidateIndex: 0,
          candidate: STORED[0],
          sendEmail: true,
          userId: repId,
        },
        { now: NOW, deps: { sendEmail, emailEnabled: () => true } }
      )
    ).toEqual({ ok: false, reason: 'stale' });
    // The router hands it back to the card
    expect(
      await callers.rep.meetingRequests.confirm({
        organizationId: org,
        leadId,
        candidateIndex: 1,
        candidate: STORED[1],
        sendEmail: false,
      })
    ).toEqual({ ok: false, reason: 'stale' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await requestOf(leadId)).confirmed).toBeNull();
    expect(await pg.select().from(leadTasks).where(eq(leadTasks.leadId, leadId))).toHaveLength(0);

    // With the options now shown, it is confirmed
    expect(
      await callers.rep.meetingRequests.confirm({
        organizationId: org,
        leadId,
        candidateIndex: 0,
        candidate: { date: '2026-10-22', time: '11:00' },
        sendEmail: false,
      })
    ).toMatchObject({ ok: true, candidate: { date: '2026-10-22', time: '11:00' } });
  });

  it('tells sales again when verified preferences replace unverified ones (#274)', async () => {
    const leadId = await createLead();
    const later = vi.fn();
    await accept(leadId, await createSubmission(leadId, 'email'), false, OPTIONS, later);
    expect(later).toHaveBeenCalledTimes(1);
    expect(
      await accept(leadId, await createSubmission(leadId, 'created'), true, OPTIONS, later)
    ).toBe('saved');
    expect(later).toHaveBeenCalledTimes(2);
    // Verified preferences replacing verified ones: no notice, as before
    expect(
      await accept(leadId, await createSubmission(leadId, 'created'), true, OPTIONS, later)
    ).toBe('saved');
    expect(later).toHaveBeenCalledTimes(2);

    // What the upsert reports
    const other = await createLead();
    const unverified = await createSubmission(other, 'email');
    expect(
      await saveMeetingPreferences(
        pg,
        {
          organizationId: org,
          leadId: other,
          submissionId: unverified,
          identityVerified: false,
          preferences: { candidates: OPTIONS, attendeeRoles: [], meetingFormat: null, topics: [], topicNote: null },
        },
        NOW
      )
    ).toEqual({ status: 'saved', first: true, replacedUnverified: false });
    expect(
      await saveMeetingPreferences(
        pg,
        {
          organizationId: org,
          leadId: other,
          submissionId: await createSubmission(other, 'created'),
          identityVerified: true,
          preferences: { candidates: OPTIONS, attendeeRoles: [], meetingFormat: null, topics: [], topicNote: null },
        },
        NOW
      )
    ).toEqual({ status: 'saved', first: false, replacedUnverified: true });
  });

  it('lets parent viewers read but not confirm, and hides other leads', async () => {
    const leadId = await createLead();
    await save(leadId);
    expect(
      (await callers.viewer.meetingRequests.get({ organizationId: org, leadId })).canEdit
    ).toBe(false);
    await expect(
      callers.viewer.meetingRequests.confirm({ organizationId: org, leadId, candidateIndex: 0, candidate: STORED[0] })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const without = await createLead();
    expect((await callers.rep.meetingRequests.get({ organizationId: org, leadId: without })).request).toBeNull();
    await expect(
      callers.rep.meetingRequests.confirm({ organizationId: org, leadId: without, candidateIndex: 0, candidate: STORED[0] })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never returns the preferences of a lead of another organization (#356)', async () => {
    const [other] = await pg
      .insert(organizations)
      .values({ name: '別組織', slug: `meeting-other-${unique()}` })
      .returning();
    try {
      const [lead] = await pg
        .insert(leads)
        .values({ organizationId: other.id, email: `meeting-${unique()}@example.co.jp` })
        .returning();
      await pg
        .insert(meetingRequests)
        .values({ organizationId: other.id, leadId: lead.id, candidates: OPTIONS });
      // Read with this organization: another organization's preferences are never returned
      const view = await callers.rep.meetingRequests.get({ organizationId: org, leadId: lead.id });
      expect(view.request).toBeNull();
    } finally {
      await pg.delete(organizations).where(eq(organizations.id, other.id));
    }
  });
});
