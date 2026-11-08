/**
 * The member's meetings for 今日 (lib/features/leads/meetings.ts getMyMeetings, #556) without a
 * database: the days read (today to Sunday, Japan), that both reads are limited to the
 * organization and the member, and how the rows are shaped. The rows the SQL matches on a real
 * PostgreSQL (whose meetings, the time of a confirmed first meeting, other organizations) are
 * covered by test/unit/integration/today-org-isolation.db.test.ts.
 * 2026-10-29 is a Thursday; its Japan week runs from Monday 2026-10-26 to Sunday 2026-11-01.
 */
import { leads } from '@/lib/db/schema';
import { leadNextMeetingTime, nested } from '@/lib/features/leads/api/list-sql';
import { MY_MEETINGS_SHOWN, getMyMeetings } from '@/lib/features/leads/meetings';
import { type QueryCall, type RecordingDb, recordingDb, sqlOf } from '@/test/mocks/recording-db';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it } from 'vitest';

type Database = Parameters<typeof getMyMeetings>[0];

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const LEAD_A = '770e8400-e29b-41d4-a716-446655440001';
const LEAD_B = '770e8400-e29b-41d4-a716-446655440002';
// Thursday 2026-10-29, 12:00 in Japan
const NOW = new Date('2026-10-29T03:00:00Z');

let fake: RecordingDb;
const db = () => fake.db as unknown as Database;

/** The count, told from the list by the columns it selects */
const isCount = (call: QueryCall) =>
  typeof call.fields === 'object' && call.fields !== null && 'total' in call.fields;

/** Answers the count and the list by what they select (they run side by side) */
const answer = (count: unknown[], list: unknown[]) => {
  fake = recordingDb((call) => (isCount(call) ? count : list));
};

beforeEach(() => {
  fake = recordingDb();
});

describe('getMyMeetings', () => {
  it('reads from today to Sunday of the Japan week', async () => {
    answer([{ total: 0 }], []);

    const result = await getMyMeetings(db(), { organizationId: ORG_ID, userId: USER_ID }, NOW);

    expect(result).toEqual({ today: '2026-10-29', weekEnd: '2026-11-01', total: 0, items: [] });
  });

  it('takes the day in Japan: just after midnight on Sunday, only Sunday is left', async () => {
    answer([{ total: 0 }], []);

    // Sunday 2026-11-01, 00:10 in Japan: today is Sunday, still in the same week
    const result = await getMyMeetings(
      db(),
      { organizationId: ORG_ID, userId: USER_ID },
      new Date('2026-10-31T15:10:00Z')
    );

    expect(result).toMatchObject({ today: '2026-11-01', weekEnd: '2026-11-01' });
  });

  it('counts and lists the organization’s leads of the member only', async () => {
    answer([{ total: 0 }], []);

    await getMyMeetings(db(), { organizationId: ORG_ID, userId: USER_ID }, NOW);

    expect(fake.calls).toHaveLength(2);
    for (const call of fake.calls) {
      expect(call).toMatchObject({ op: 'select', table: leads, joins: [] });
      const where = sqlOf(call.where);
      expect(where.sql).toMatch(/^\("leads"\."organization_id" = \$1 and /);
      expect(where.params).toEqual([ORG_ID, '2026-10-29', '2026-11-01', USER_ID, USER_ID]);
      // Assigned to the member, or nobody assigned and the member set the date
      expect(where.sql).toContain(
        '("leads"."assignee_user_id" = $4 or ("leads"."assignee_user_id" is null and (case when'
      );
    }
    const list = fake.calls.find((call) => !isCount(call));
    expect(list?.limit).toBe(MY_MEETINGS_SHOWN);
    // Date, then time (none last), then company and id
    expect(list?.orderBy).toHaveLength(4);
  });

  it('returns the total and the meetings with their time and marks', async () => {
    answer(
      [{ total: '61' }],
      [
        {
          leadId: LEAD_A,
          name: '山田 太郎',
          company: '架空商事',
          status: 'nurturing',
          assigneeUserId: null,
          nextMeetingDate: '2026-10-29',
          nextMeetingTime: '09:00',
          firstMeeting: true,
          dealRating: 'a',
        },
        {
          leadId: LEAD_B,
          name: null,
          company: null,
          status: 'won',
          assigneeUserId: USER_ID,
          nextMeetingDate: '2026-10-31',
          nextMeetingTime: null,
          firstMeeting: false,
          dealRating: null,
        },
      ]
    );

    const result = await getMyMeetings(db(), { organizationId: ORG_ID, userId: USER_ID }, NOW);

    expect(result.total).toBe(61);
    expect(result.items).toEqual([
      {
        leadId: LEAD_A,
        name: '山田 太郎',
        company: '架空商事',
        status: 'nurturing',
        nextMeetingDate: '2026-10-29',
        nextMeetingTime: '09:00',
        firstMeeting: true,
        dealRating: 'a',
        unassigned: true,
      },
      {
        leadId: LEAD_B,
        name: null,
        company: null,
        status: 'won',
        nextMeetingDate: '2026-10-31',
        nextMeetingTime: null,
        firstMeeting: false,
        dealRating: null,
        unassigned: false,
      },
    ]);
  });
});

describe('nested', () => {
  const selectedFromLeads = (time: typeof leadNextMeetingTime) =>
    new QueryBuilder().select({ time }).from(leads).toSQL().sql;

  it('keeps the lead’s table in a value selected from leads alone', () => {
    expect(selectedFromLeads(nested(leadNextMeetingTime))).toContain(
      'select mr.confirmed_time from meeting_requests mr where mr.lead_id = "leads"."id" and mr.organization_id = "leads"."organization_id"'
    );
  });

  it('is needed: without it the subquery compares with its own columns', () => {
    // "id" inside the subquery is meeting_requests.id, and "organization_id" its own
    expect(selectedFromLeads(leadNextMeetingTime)).toContain(
      'select mr.confirmed_time from meeting_requests mr where mr.lead_id = "id" and mr.organization_id = "organization_id"'
    );
  });
});
