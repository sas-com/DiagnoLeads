/**
 * First meeting preferences and their confirmation in the database
 * (lib/features/meeting-requests/service.ts, #155, #241, #274) without a database (#6): what is
 * written and under which condition (a confirmed meeting, or verified preferences met by an
 * unverified answer, are never replaced), that every read and write is limited to the
 * organization, who is told, and each outcome of a confirmation (not found, stale, the next
 * action moved or added, the email, and when it creates the lead's deal in 見極め, #854), and that
 * the preferences notice skips an assignee no longer a member who holds leads (#974). The
 * database is test/mocks/recording-db.ts and the deals feature is mocked; the same functions on a
 * real PostgreSQL (the conflict condition, the snapshot read of the replaced row, the locks, the
 * deal) are covered by test/unit/integration/meeting-requests.db.test.ts and
 * deals-auto-qualification.db.test.ts.
 * Made-up names. 2026-10-16 is a Friday.
 */
import { leadTasks, leads, meetingRequests, organizations, users } from '@/lib/db/schema';
import type { QualificationDealOutcome } from '@/lib/features/deals/service';
import { ASSIGNABLE_ROLES } from '@/lib/features/leads/assignment';
import {
  type ConfirmDeps,
  MEETING_PREFERENCES_WINDOW_MS,
  acceptMeetingPreferences,
  confirmMeeting,
  getMeetingRequest,
  notifyPreferencesReceived,
  saveMeetingPreferences,
} from '@/lib/features/meeting-requests/service';
import type { MeetingPreferences } from '@/lib/features/meeting-requests/types/schemas';
import {
  type QueryCall,
  type RecordingDb,
  type RecordingExecutor,
  recordingDb,
  sqlOf,
} from '@/test/mocks/recording-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notices = vi.hoisted(() => ({
  notifyUsersInApp: vi.fn(async () => {}),
  notifyOrganizationMembers: vi.fn(async () => {}),
}));
vi.mock('@/lib/features/leads/assignment-notify', () => ({
  notifyUsersInApp: notices.notifyUsersInApp,
}));
vi.mock('@/lib/features/notifications/notification-service', () => ({
  notifyOrganizationMembers: notices.notifyOrganizationMembers,
}));
const deals = vi.hoisted(() => ({
  ensureQualificationDeal: vi.fn(),
  afterDealChanges: vi.fn(),
}));
vi.mock('@/lib/features/deals/service', () => deals);

type Database = Parameters<typeof saveMeetingPreferences>[0];

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ASSIGNEE_ID = '550e8400-e29b-41d4-a716-446655440001';
const INTAKE_ID = '550e8400-e29b-41d4-a716-446655440002';
const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '880e8400-e29b-41d4-a716-446655440000';
const TASK_ID = '990e8400-e29b-41d4-a716-446655440000';
const DEAL_ID = 'aa0e8400-e29b-41d4-a716-446655440000';
// Friday 2026-10-16, 12:00 in Japan: candidates may run from 10-17 to 12-15
const NOW = new Date('2026-10-16T03:00:00Z');

const preferences: MeetingPreferences = {
  candidates: [
    { date: '2026-10-22', time: '14:00' },
    { date: '2026-10-21', time: '10:00' },
  ],
  attendeeRoles: ['it_manager'],
  meetingFormat: 'online',
  topics: ['cost'],
  topicNote: '概算を知りたい',
};

let fake: RecordingDb;
const db = () => fake.db as unknown as Database;

const created: QualificationDealOutcome = { created: true, dealId: DEAL_ID, lead: null };

beforeEach(() => {
  fake = recordingDb();
  notices.notifyUsersInApp.mockClear();
  notices.notifyOrganizationMembers.mockClear();
  deals.ensureQualificationDeal.mockReset();
  deals.ensureQualificationDeal.mockResolvedValue(created);
  deals.afterDealChanges.mockReset();
  deals.afterDealChanges.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('saveMeetingPreferences', () => {
  const input = (identityVerified: boolean, overrides: Partial<MeetingPreferences> = {}) => ({
    organizationId: ORG_ID,
    leadId: LEAD_ID,
    submissionId: SUBMISSION_ID,
    identityVerified,
    preferences: { ...preferences, ...overrides },
  });

  it.each([
    ['today', '2026-10-16'],
    ['more than 60 days ahead', '2026-12-16'],
  ])('refuses a date of %s without writing', async (_label, date) => {
    const outcome = await saveMeetingPreferences(
      db(),
      input(true, { candidates: [{ date, time: '10:00' }] }),
      NOW
    );

    expect(outcome).toEqual({ status: 'out_of_range' });
    expect(fake.calls).toHaveLength(0);
  });

  it("stores the preferences on the lead's request, the dates in order", async () => {
    fake.results.push([{ inserted: true, replacedUnverified: false }]);

    expect(await saveMeetingPreferences(db(), input(true), NOW)).toEqual({
      status: 'saved',
      first: true,
      replacedUnverified: false,
    });

    const [call] = fake.calls;
    expect(call).toMatchObject({ op: 'insert', table: meetingRequests });
    const values = {
      submissionId: SUBMISSION_ID,
      candidates: [
        { date: '2026-10-21', time: '10:00' },
        { date: '2026-10-22', time: '14:00' },
      ],
      attendeeRoles: preferences.attendeeRoles,
      meetingFormat: 'online',
      topics: ['cost'],
      topicNote: '概算を知りたい',
      updatedAt: NOW,
    };
    expect(call.values).toEqual({
      ...values,
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      createdAt: NOW,
    });
    expect(call.onConflict?.config).toMatchObject({ target: meetingRequests.leadId, set: values });
  });

  it('replaces only unconfirmed preferences for a verified answer', async () => {
    fake.results.push([{ inserted: false, replacedUnverified: true }]);

    expect(await saveMeetingPreferences(db(), input(true), NOW)).toEqual({
      status: 'saved',
      first: false,
      replacedUnverified: true,
    });
    const setWhere = sqlOf(
      fake.calls[0].onConflict?.config?.setWhere as Parameters<typeof sqlOf>[0]
    );
    expect(setWhere.sql).toBe('"meeting_requests"."confirmed_on" is null');
  });

  it('replaces only unconfirmed preferences of unverified answers for an unverified one (#274)', async () => {
    fake.results.push([{ inserted: false, replacedUnverified: true }]);

    await saveMeetingPreferences(db(), input(false), NOW);

    const setWhere = sqlOf(
      fake.calls[0].onConflict?.config?.setWhere as Parameters<typeof sqlOf>[0]
    );
    expect(setWhere.sql).toMatch(
      /^\("meeting_requests"\."confirmed_on" is null and not not exists \(/
    );
    expect(setWhere.sql).toContain('where ds.id = "meeting_requests".submission_id');
    expect(setWhere.sql).toContain('and ds.lead_created = false');
  });

  it('reports a confirmed meeting when a verified answer changed nothing', async () => {
    fake.results.push([]);

    expect(await saveMeetingPreferences(db(), input(true), NOW)).toEqual({ status: 'confirmed' });
    expect(fake.calls).toHaveLength(1);
  });

  it.each([
    ['a confirmed meeting', '2026-10-21', { status: 'confirmed' }],
    ['verified preferences that were kept', null, { status: 'kept_verified' }],
  ])(
    'tells %s apart when an unverified answer changed nothing',
    async (_label, confirmedOn, expected) => {
      fake.results.push([], [{ confirmedOn }]);

      expect(await saveMeetingPreferences(db(), input(false), NOW)).toEqual(expected);

      const read = fake.calls[1];
      expect(read).toMatchObject({ op: 'select', table: meetingRequests });
      expect(sqlOf(read.where)).toEqual({
        sql: '("meeting_requests"."lead_id" = $1 and "meeting_requests"."organization_id" = $2)',
        params: [LEAD_ID, ORG_ID],
      });
    }
  );
});

describe('notifyPreferencesReceived', () => {
  const input = { organizationId: ORG_ID, leadId: LEAD_ID, identityVerified: true, preferences };

  it('tells nobody about a lead that is not in the organization', async () => {
    fake.results.push([]);

    await notifyPreferencesReceived(db(), input);

    expect(sqlOf(fake.calls[0].where)).toEqual({
      sql: '("leads"."id" = $1 and "leads"."organization_id" = $2)',
      params: [LEAD_ID, ORG_ID],
    });
    expect(notices.notifyUsersInApp).not.toHaveBeenCalled();
    expect(notices.notifyOrganizationMembers).not.toHaveBeenCalled();
  });

  it("tells the lead's assignee", async () => {
    fake.results.push(
      [{ name: '山田 太郎', company: '架空商事', assigneeId: ASSIGNEE_ID }],
      [{ userId: ASSIGNEE_ID, name: '担当', email: 'assignee@example.com', role: 'member' }]
    );

    await notifyPreferencesReceived(db(), input);

    expect(notices.notifyUsersInApp).toHaveBeenCalledWith(
      [ASSIGNEE_ID],
      ORG_ID,
      'consultation_requested',
      '【希望日時】架空商事 山田 太郎 様 から初回商談の希望日時が届きました',
      expect.stringContaining(
        '希望：10月21日（水）10:00、10月22日（木）14:00（オンライン）。相談したい内容：費用の目安。'
      ),
      { leadId: LEAD_ID, meetingRequest: true }
    );
    // Only once they are found to be a member who may hold leads (#974); the intake members are
    // not read then
    expect(fake.calls).toHaveLength(2);
    expect(sqlOf(fake.calls[1].where).params).toEqual([ORG_ID, ASSIGNEE_ID, ...ASSIGNABLE_ROLES]);
  });

  it('tells the intake members instead of an assignee no longer a member who holds leads (#974)', async () => {
    fake.results.push(
      [{ name: '山田 太郎', company: '架空商事', assigneeId: ASSIGNEE_ID }],
      [],
      [{ settings: { leadIntakeUserIds: [INTAKE_ID] } }],
      [{ userId: INTAKE_ID, name: '窓口', email: 'intake@example.com', role: 'member' }]
    );

    await notifyPreferencesReceived(db(), input);

    expect(notices.notifyUsersInApp).toHaveBeenCalledTimes(1);
    expect(notices.notifyUsersInApp).toHaveBeenCalledWith(
      [INTAKE_ID],
      ORG_ID,
      'consultation_requested',
      expect.any(String),
      expect.any(String),
      { leadId: LEAD_ID, meetingRequest: true }
    );
  });

  it('tells the intake members of the organization when the lead has no assignee', async () => {
    fake.results.push(
      [{ name: null, company: '架空商事', assigneeId: null }],
      [{ settings: { leadIntakeUserIds: [INTAKE_ID] } }],
      [{ userId: INTAKE_ID, name: '窓口', email: 'intake@example.com', role: 'member' }]
    );

    await notifyPreferencesReceived(db(), { ...input, identityVerified: false });

    expect(notices.notifyUsersInApp).toHaveBeenCalledWith(
      [INTAKE_ID],
      ORG_ID,
      'consultation_requested',
      '【希望日時】（本人確認なし）架空商事 から初回商談の希望日時が届きました',
      expect.stringContaining('確定する前にご本人に確認してください。'),
      { leadId: LEAD_ID, meetingRequest: true }
    );
    expect(sqlOf(fake.calls[1].where).params).toEqual([ORG_ID]);
  });

  it('tells every member without an assignee or intake members', async () => {
    fake.results.push([{ name: null, company: null, assigneeId: null }], [{ settings: {} }]);

    await notifyPreferencesReceived(db(), input);

    expect(notices.notifyUsersInApp).not.toHaveBeenCalled();
    expect(notices.notifyOrganizationMembers).toHaveBeenCalledWith(
      ORG_ID,
      'consultation_requested',
      '【希望日時】リード から初回商談の希望日時が届きました',
      expect.any(String),
      { leadId: LEAD_ID, meetingRequest: true }
    );
  });

  it('logs a failure and never fails the request', async () => {
    const error = new Error('connection lost');
    fake = recordingDb(() => {
      throw error;
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(notifyPreferencesReceived(db(), input)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith('Meeting preferences notice failed:', error);
  });
});

describe('getMeetingRequest', () => {
  const stored = {
    candidates: [{ date: '2026-10-21', time: '10:00' }],
    attendeeRoles: ['it_manager'],
    meetingFormat: 'onsite',
    topics: ['cost', 'retired_topic', 'schedule'],
    topicNote: null,
    confirmedOn: null,
    confirmedTime: null,
    confirmedAt: null,
    confirmedByName: null,
    confirmationEmailedAt: null,
    identityVerified: true,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("returns null when the organization's lead has no request", async () => {
    fake.results.push([]);

    expect(await getMeetingRequest(db(), { organizationId: ORG_ID, leadId: LEAD_ID })).toBeNull();
    const [call] = fake.calls;
    expect(call.table).toBe(meetingRequests);
    expect(call.joins).toEqual([expect.objectContaining({ type: 'left', table: users })]);
    expect(sqlOf(call.where)).toEqual({
      sql: '("meeting_requests"."lead_id" = $1 and "meeting_requests"."organization_id" = $2)',
      params: [LEAD_ID, ORG_ID],
    });
  });

  it('keeps only the known topics, and no confirmation before sales confirm', async () => {
    fake.results.push([stored]);

    expect(await getMeetingRequest(db(), { organizationId: ORG_ID, leadId: LEAD_ID })).toEqual({
      candidates: stored.candidates,
      attendeeRoles: ['it_manager'],
      meetingFormat: 'onsite',
      topics: ['cost', 'schedule'],
      topicNote: null,
      confirmed: null,
      confirmationEmailedAt: null,
      identityVerified: true,
      requestedAt: NOW,
      updatedAt: NOW,
    });
  });

  it('shows the confirmed candidate with who confirmed it', async () => {
    const confirmedAt = new Date('2026-10-17T01:00:00Z');
    fake.results.push([
      {
        ...stored,
        identityVerified: false,
        confirmedOn: '2026-10-21',
        confirmedTime: '10:00',
        confirmedAt,
        confirmedByName: '青木',
      },
    ]);

    expect(
      await getMeetingRequest(db(), { organizationId: ORG_ID, leadId: LEAD_ID })
    ).toMatchObject({
      confirmed: { date: '2026-10-21', time: '10:00', at: confirmedAt, byName: '青木' },
      identityVerified: false,
    });
  });
});

describe('confirmMeeting', () => {
  const candidate = { date: '2026-10-21', time: '10:00' };
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: REQUEST_ID,
    candidates: [candidate, { date: '2026-10-22', time: '14:00' }],
    meetingFormat: 'online',
    taskId: null,
    confirmedOn: null,
    email: 'yamada@example.com',
    leadName: '山田 太郎',
    company: '架空商事',
    organizationName: '架空システム',
    ...overrides,
  });
  /** The lead, locked first */
  const lead = [{ id: LEAD_ID }];
  const input = (overrides: Record<string, unknown> = {}) => ({
    organizationId: ORG_ID,
    leadId: LEAD_ID,
    candidateIndex: 0,
    candidate,
    sendEmail: false,
    userId: USER_ID,
    ...overrides,
  });
  const deps = (overrides: Partial<ConfirmDeps> = {}): Partial<ConfirmDeps> => ({
    sendEmail: vi.fn(async () => ({})),
    emailEnabled: () => true,
    ...overrides,
  });
  const writes = () => fake.calls.filter((call) => call.op !== 'select');

  it("locks the organization's lead, then its request, and confirms nothing when there is none", async () => {
    fake.results.push(lead, []);

    expect(await confirmMeeting(db(), input(), { now: NOW })).toEqual({
      ok: false,
      reason: 'not_found',
    });

    const [lock, read] = fake.calls;
    // The lead before its rows, as the deals take it (no deadlock with them or a deletion)
    expect(lock).toMatchObject({ op: 'select', table: leads, inTransaction: true });
    expect(lock.lock).toEqual({ strength: 'no key update', config: undefined });
    expect(sqlOf(lock.where)).toEqual({
      sql: '("leads"."id" = $1 and "leads"."organization_id" = $2)',
      params: [LEAD_ID, ORG_ID],
    });
    expect(read).toMatchObject({ table: meetingRequests, inTransaction: true });
    expect(read.lock).toEqual({ strength: 'update', config: { of: meetingRequests } });
    expect(read.joins.map((join) => join.table)).toEqual([leads, organizations]);
    expect(sqlOf(read.where)).toEqual({
      sql: '("meeting_requests"."lead_id" = $1 and "meeting_requests"."organization_id" = $2)',
      params: [LEAD_ID, ORG_ID],
    });
    expect(writes()).toHaveLength(0);
    expect(deals.ensureQualificationDeal).not.toHaveBeenCalled();
  });

  it('confirms nothing for a lead the organization does not have', async () => {
    fake.results.push([]);

    expect(await confirmMeeting(db(), input(), { now: NOW })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(fake.calls).toHaveLength(1);
    expect(deals.ensureQualificationDeal).not.toHaveBeenCalled();
  });

  it('confirms nothing for a candidate the request does not have', async () => {
    fake.results.push(lead, [row()]);

    expect(await confirmMeeting(db(), input({ candidateIndex: 4 }), { now: NOW })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(writes()).toHaveLength(0);
    expect(deals.ensureQualificationDeal).not.toHaveBeenCalled();
  });

  it('confirms nothing when the candidate is no longer the one sales saw (#274)', async () => {
    fake.results.push(lead, [row({ candidates: [{ date: '2026-10-21', time: '15:00' }] })]);

    expect(await confirmMeeting(db(), input(), { now: NOW })).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(writes()).toHaveLength(0);
    expect(deals.ensureQualificationDeal).not.toHaveBeenCalled();
    expect(deals.afterDealChanges).not.toHaveBeenCalled();
  });

  it('adds a next action on the day and records the confirmation', async () => {
    fake.results.push(lead, [row()], [{ id: TASK_ID }], []);

    expect(await confirmMeeting(db(), input(), { now: NOW, deps: deps() })).toEqual({
      ok: true,
      candidate,
      email: 'not_requested',
      dealCreated: true,
    });

    const [task, confirmation] = writes();
    expect(task).toMatchObject({
      op: 'insert',
      table: leadTasks,
      inTransaction: true,
      values: {
        organizationId: ORG_ID,
        leadId: LEAD_ID,
        title: '初回商談（オンライン） 10:00〜',
        dueOn: '2026-10-21',
        source: 'meeting_request',
        createdBy: USER_ID,
        updatedBy: USER_ID,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    expect(confirmation).toMatchObject({
      op: 'update',
      table: meetingRequests,
      set: {
        confirmedOn: '2026-10-21',
        confirmedTime: '10:00',
        confirmedAt: NOW,
        confirmedBy: USER_ID,
        taskId: TASK_ID,
        updatedAt: NOW,
      },
    });
    expect(sqlOf(confirmation.where).params).toEqual([REQUEST_ID]);
  });

  it('moves the next action of an earlier confirmation to the other candidate', async () => {
    fake.results.push(
      lead,
      [row({ taskId: TASK_ID, meetingFormat: null, confirmedOn: '2026-10-21' })],
      [{ id: TASK_ID }],
      []
    );

    await confirmMeeting(
      db(),
      input({ candidateIndex: 1, candidate: { date: '2026-10-22', time: '14:00' } }),
      { now: NOW }
    );

    const [move, confirmation] = writes();
    expect(move).toMatchObject({
      op: 'update',
      table: leadTasks,
      set: {
        title: '初回商談 14:00〜',
        dueOn: '2026-10-22',
        completedAt: null,
        notifiedDueAt: null,
        notifiedOverdueAt: null,
        updatedBy: USER_ID,
      },
    });
    expect(sqlOf(move.where).params).toEqual([TASK_ID]);
    expect(confirmation.set).toMatchObject({ confirmedOn: '2026-10-22', taskId: TASK_ID });
    expect(writes().some((call) => call.op === 'insert')).toBe(false);
  });

  it('adds a next action again when the earlier one was deleted', async () => {
    const newTask = '990e8400-e29b-41d4-a716-446655440001';
    fake.results.push(lead, [row({ taskId: TASK_ID })], [], [{ id: newTask }], []);

    await confirmMeeting(db(), input(), { now: NOW });

    expect(writes().map((call) => [call.op, call.table])).toEqual([
      ['update', leadTasks],
      ['insert', leadTasks],
      ['update', meetingRequests],
    ]);
    expect(writes()[2].set).toMatchObject({ taskId: newTask });
  });

  // The deal in 見極め of the first meeting (#854)
  describe('the deal', () => {
    it('is created on the first confirmation, in the transaction, with its webhooks after the commit and before the email', async () => {
      fake.results.push(lead, [row()], [{ id: TASK_ID }], [], [{ name: '青木' }], []);
      const order: string[] = [];
      const transaction = fake.db.transaction;
      fake.db.transaction = async <T>(fn: (tx: RecordingExecutor) => Promise<T>) => {
        const result = await transaction(fn);
        order.push('commit');
        return result;
      };
      deals.ensureQualificationDeal.mockImplementation(async () => {
        order.push('ensure');
        return created;
      });
      deals.afterDealChanges.mockImplementation(async () => {
        order.push('webhooks');
      });
      const send = vi.fn(async () => {
        order.push('email');
        return {};
      });

      const outcome = await confirmMeeting(db(), input({ sendEmail: true }), {
        now: NOW,
        deps: deps({ sendEmail: send }),
      });

      expect(outcome).toEqual({ ok: true, candidate, email: 'sent', dealCreated: true });
      expect(order).toEqual(['ensure', 'commit', 'webhooks', 'email']);
      expect(deals.ensureQualificationDeal).toHaveBeenCalledTimes(1);
      const [tx, values, at] = deals.ensureQualificationDeal.mock.calls[0];
      // The confirmation's transaction, not the database
      expect(tx).not.toBe(fake.db);
      expect(values).toEqual({
        organizationId: ORG_ID,
        leadId: LEAD_ID,
        userId: USER_ID,
        source: 'meeting_request',
        meetingOn: '2026-10-21',
      });
      expect(at).toBe(NOW);
      expect(deals.afterDealChanges).toHaveBeenCalledWith(
        fake.db,
        { organizationId: ORG_ID, userId: USER_ID },
        [created]
      );
    });

    it('is created when the meeting moves to another day', async () => {
      fake.results.push(lead, [row({ taskId: TASK_ID, confirmedOn: '2026-10-22' })], [{ id: TASK_ID }], []);

      expect(await confirmMeeting(db(), input(), { now: NOW })).toMatchObject({
        ok: true,
        dealCreated: true,
      });
      expect(deals.ensureQualificationDeal).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ meetingOn: '2026-10-21' }),
        NOW
      );
    });

    it('is never created for another time of the same day, even after the deal was lost', async () => {
      fake.results.push(
        lead,
        [
          row({
            candidates: [candidate, { date: '2026-10-21', time: '15:00' }],
            taskId: TASK_ID,
            confirmedOn: '2026-10-21',
          }),
        ],
        [{ id: TASK_ID }],
        []
      );

      expect(
        await confirmMeeting(
          db(),
          input({ candidateIndex: 1, candidate: { date: '2026-10-21', time: '15:00' } }),
          { now: NOW }
        )
      ).toEqual({
        ok: true,
        candidate: { date: '2026-10-21', time: '15:00' },
        email: 'not_requested',
        dealCreated: false,
      });
      expect(deals.ensureQualificationDeal).not.toHaveBeenCalled();
      expect(deals.afterDealChanges).not.toHaveBeenCalled();
      // The meeting itself is confirmed
      expect(writes().at(-1)?.set).toMatchObject({ confirmedTime: '15:00' });
    });

    it.each(['open_deal', 'won', 'phase_ahead', 'lead_not_found'] as const)(
      'is not created for a lead it skips (%s), and the meeting is confirmed all the same',
      async (skipped) => {
        fake.results.push(lead, [row()], [{ id: TASK_ID }], []);
        deals.ensureQualificationDeal.mockResolvedValue({ created: false, skipped });

        expect(await confirmMeeting(db(), input(), { now: NOW })).toEqual({
          ok: true,
          candidate,
          email: 'not_requested',
          dealCreated: false,
        });
        expect(deals.ensureQualificationDeal).toHaveBeenCalledTimes(1);
        expect(deals.afterDealChanges).not.toHaveBeenCalled();
        expect(writes().at(-1)?.set).toMatchObject({ confirmedOn: '2026-10-21' });
      }
    );

    it('is answered as whether one was created, never as the deal (#276)', async () => {
      fake.results.push(lead, [row()], [{ id: TASK_ID }], []);

      const outcome = await confirmMeeting(db(), input(), { now: NOW });

      expect(Object.keys(outcome).sort()).toEqual(['candidate', 'dealCreated', 'email', 'ok']);
      expect(JSON.stringify(outcome)).not.toContain(DEAL_ID);
    });
  });

  it('sends no email when email is not configured', async () => {
    fake.results.push(lead, [row()], [{ id: TASK_ID }], []);
    const send = vi.fn();

    expect(
      await confirmMeeting(db(), input({ sendEmail: true }), {
        now: NOW,
        deps: deps({ sendEmail: send, emailEnabled: () => false }),
      })
    ).toMatchObject({ ok: true, email: 'not_configured', dealCreated: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('mails only the allowed domains in test mode', async () => {
    vi.stubEnv('APP_TEST_MODE', 'true');
    vi.stubEnv('APP_TEST_MODE_EMAIL_DOMAINS', 'sas-com.com');
    fake.results.push(lead, [row()], [{ id: TASK_ID }], []);
    const send = vi.fn();

    expect(
      await confirmMeeting(db(), input({ sendEmail: true }), {
        now: NOW,
        deps: deps({ sendEmail: send }),
      })
    ).toMatchObject({ ok: true, email: 'not_allowed', dealCreated: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('mails the respondent with who confirmed it and records when', async () => {
    fake.results.push(lead, [row()], [{ id: TASK_ID }], [], [{ name: '青木' }], []);
    const send = vi.fn(async () => ({}));

    expect(
      await confirmMeeting(db(), input({ sendEmail: true }), {
        now: NOW,
        deps: deps({ sendEmail: send }),
      })
    ).toEqual({ ok: true, candidate, email: 'sent', dealCreated: true });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['yamada@example.com'],
        subject: '【日程のご連絡】初回のご相談：10月21日（水）10:00〜',
      })
    );
    const mail = (send.mock.calls[0] as unknown as [{ text: string }])[0];
    expect(mail.text).toContain('担当：青木');
    const confirmer = fake.calls.find((call: QueryCall) => call.table === users);
    expect(sqlOf(confirmer?.where).params).toEqual([USER_ID]);
    const emailed = writes().at(-1);
    expect(emailed).toMatchObject({ op: 'update', table: meetingRequests, inTransaction: false });
    expect(emailed?.set?.confirmationEmailedAt).toBeInstanceOf(Date);
    expect(sqlOf(emailed?.where).params).toEqual([REQUEST_ID]);
  });

  it('keeps the confirmation and reports a failed email', async () => {
    fake.results.push(lead, [row()], [{ id: TASK_ID }], []);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('Resend is down');

    expect(
      await confirmMeeting(db(), input({ sendEmail: true }), {
        now: NOW,
        deps: deps({
          sendEmail: async () => {
            throw error;
          },
        }),
      })
    ).toEqual({ ok: true, candidate, email: 'failed', dealCreated: true });
    expect(logged).toHaveBeenCalledWith('Meeting confirmation email failed:', error);
    // The confirmation stays; no time of an email is recorded
    expect(writes().filter((call) => call.set && 'confirmationEmailedAt' in call.set)).toHaveLength(
      0
    );
  });
});

describe('acceptMeetingPreferences', () => {
  const requestedAt = new Date(NOW.getTime() - 60 * 60 * 1000);
  const input = (overrides: Record<string, unknown> = {}) => ({
    organizationId: ORG_ID,
    leadId: LEAD_ID as string | null,
    submissionId: SUBMISSION_ID,
    identityVerified: true,
    requestedAt,
    preferences,
    ...overrides,
  });

  it('takes nothing for an answer without a lead', async () => {
    const later = vi.fn();

    expect(await acceptMeetingPreferences(db(), input({ leadId: null }), later, NOW)).toBe(
      'unavailable'
    );
    expect(fake.calls).toHaveLength(0);
    expect(later).not.toHaveBeenCalled();
  });

  it('still takes preferences at the end of the day after the request (#241)', async () => {
    fake.results.push([{ inserted: true, replacedUnverified: false }]);

    const status = await acceptMeetingPreferences(
      db(),
      input({ requestedAt: new Date(NOW.getTime() - MEETING_PREFERENCES_WINDOW_MS) }),
      vi.fn(),
      NOW
    );

    expect(status).toBe('saved');
  });

  it('tells sales about the first preferences after the response', async () => {
    fake.results.push([{ inserted: true, replacedUnverified: false }]);
    const tasks: (() => Promise<void>)[] = [];

    expect(await acceptMeetingPreferences(db(), input(), (task) => tasks.push(task), NOW)).toBe(
      'saved'
    );
    expect(tasks).toHaveLength(1);
    // Nothing is told until the task runs after the response
    expect(notices.notifyUsersInApp).not.toHaveBeenCalled();

    fake.results.push(
      [{ name: null, company: '架空商事', assigneeId: ASSIGNEE_ID }],
      [{ userId: ASSIGNEE_ID, name: '担当', email: 'assignee@example.com', role: 'member' }]
    );
    await tasks[0]();
    expect(notices.notifyUsersInApp).toHaveBeenCalledWith(
      [ASSIGNEE_ID],
      ORG_ID,
      'consultation_requested',
      expect.any(String),
      expect.any(String),
      { leadId: LEAD_ID, meetingRequest: true }
    );
  });

  it('tells sales again when verified preferences replace unverified ones (#274)', async () => {
    fake.results.push([{ inserted: false, replacedUnverified: true }]);
    const later = vi.fn();

    await acceptMeetingPreferences(db(), input(), later, NOW);

    expect(later).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['verified preferences replace verified ones', true, false],
    ['unverified preferences replace unverified ones', false, true],
  ])('tells nobody again when %s', async (_label, identityVerified, replacedUnverified) => {
    fake.results.push([{ inserted: false, replacedUnverified }]);
    const later = vi.fn();

    expect(await acceptMeetingPreferences(db(), input({ identityVerified }), later, NOW)).toBe(
      'saved'
    );
    expect(later).not.toHaveBeenCalled();
  });

  it('answers unavailable when an unverified answer met verified preferences', async () => {
    fake.results.push([], [{ confirmedOn: null }]);
    const later = vi.fn();

    expect(
      await acceptMeetingPreferences(db(), input({ identityVerified: false }), later, NOW)
    ).toBe('unavailable');
    expect(later).not.toHaveBeenCalled();
  });

  it('answers confirmed when sales already confirmed a meeting', async () => {
    fake.results.push([]);

    expect(await acceptMeetingPreferences(db(), input(), vi.fn(), NOW)).toBe('confirmed');
  });
});
