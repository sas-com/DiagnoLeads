/**
 * The dashboard's meetings (lib/features/leads/meetings.ts, #137) without a database (#6): the
 * Japan week the meetings of this week are read for, that both reads are limited to the
 * organization, how the rows are shaped, and the period of the KPI 「初回商談から次回日程が決まった率」.
 * The database is test/mocks/recording-db.ts; the rows the SQL matches on a real PostgreSQL (the
 * week's meetings and the KPI through the leads router, with the first hearing of each lead) are
 * covered by test/unit/integration/lead-meetings-export.db.test.ts, and the week's meetings after
 * a confirmed meeting by meeting-requests.db.test.ts.
 * 2026-10-16 is a Friday; its Japan week runs from Monday 2026-10-12 to Sunday 2026-10-18.
 */
import { leads, users } from '@/lib/db/schema';
import {
  WEEK_MEETINGS_SHOWN,
  getNextMeetingRate,
  getWeekMeetings,
} from '@/lib/features/leads/meetings';
import { type QueryCall, type RecordingDb, recordingDb, sqlOf } from '@/test/mocks/recording-db';
import { beforeEach, describe, expect, it } from 'vitest';

type Database = Parameters<typeof getWeekMeetings>[0];

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_A = '770e8400-e29b-41d4-a716-446655440001';
const LEAD_B = '770e8400-e29b-41d4-a716-446655440002';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
// Friday 2026-10-16, 12:00 in Japan
const NOW = new Date('2026-10-16T03:00:00Z');

let fake: RecordingDb;
const db = () => fake.db as unknown as Database;

beforeEach(() => {
  fake = recordingDb();
});

/** The count of getWeekMeetings, told from the list by the columns it selects */
const isCount = (call: QueryCall) =>
  typeof call.fields === 'object' && call.fields !== null && 'total' in call.fields;

/**
 * Answers the count and the list of getWeekMeetings by what they select: the two reads run side
 * by side, so the order they are awaited in is not relied on
 */
const answerWeek = (count: unknown[], list: unknown[]) => {
  fake = recordingDb((call) => (isCount(call) ? count : list));
};

describe('getWeekMeetings', () => {
  it('reads the Japan week of now, Monday to Sunday', async () => {
    answerWeek([{ total: 0 }], []);

    const week = await getWeekMeetings(db(), ORG_ID, NOW);

    expect(week).toEqual({
      weekStart: '2026-10-12',
      weekEnd: '2026-10-18',
      today: '2026-10-16',
      total: 0,
      items: [],
    });
  });

  it('starts the week on the Monday also late on Sunday night in Japan', async () => {
    answerWeek([{ total: 0 }], []);

    // Sunday 2026-10-18, 23:30 in Japan
    const week = await getWeekMeetings(db(), ORG_ID, new Date('2026-10-18T14:30:00Z'));

    expect(week).toMatchObject({
      weekStart: '2026-10-12',
      weekEnd: '2026-10-18',
      today: '2026-10-18',
    });
  });

  it('counts and lists only the leads of the organization with a next meeting in the week', async () => {
    answerWeek([{ total: 0 }], []);

    await getWeekMeetings(db(), ORG_ID, NOW);

    expect(fake.calls).toHaveLength(2);
    const count = fake.calls.find(isCount);
    const list = fake.calls.find((call) => !isCount(call));
    if (!count || !list) throw new Error('Expected a count and a list');
    for (const call of [count, list]) {
      expect(call).toMatchObject({ op: 'select', table: leads });
      const where = sqlOf(call.where);
      expect(where.sql).toMatch(
        /^\("leads"\."organization_id" = \$1 and .* between \$\d+ and \$\d+\)$/s
      );
      expect(where.params[0]).toBe(ORG_ID);
      expect(where.params.slice(-2)).toEqual(['2026-10-12', '2026-10-18']);
    }
    // The card shows the first ones, earliest first; the assignee is joined, not required
    expect(list.limit).toBe(WEEK_MEETINGS_SHOWN);
    expect(list.orderBy).toHaveLength(3);
    expect(list.joins).toEqual([expect.objectContaining({ type: 'left', table: users })]);
  });

  it('returns the total and the meetings with their assignee', async () => {
    answerWeek(
      [{ total: '12' }],
      [
        {
          leadId: LEAD_A,
          name: '山田 太郎',
          company: '架空商事',
          status: 'contacted',
          nextMeetingDate: '2026-10-14',
          dealRating: 'A',
          assigneeId: USER_ID,
          assigneeName: '青木',
          assigneeEmail: 'aoki@example.com',
        },
        {
          leadId: LEAD_B,
          name: null,
          company: null,
          status: 'won',
          nextMeetingDate: null,
          dealRating: null,
          assigneeId: null,
          assigneeName: null,
          assigneeEmail: null,
        },
      ]
    );

    const week = await getWeekMeetings(db(), ORG_ID, NOW);

    expect(week.total).toBe(12);
    expect(week.items).toEqual([
      {
        leadId: LEAD_A,
        name: '山田 太郎',
        company: '架空商事',
        status: 'contacted',
        nextMeetingDate: '2026-10-14',
        dealRating: 'A',
        assignee: { id: USER_ID, name: '青木', email: 'aoki@example.com' },
      },
      {
        leadId: LEAD_B,
        name: null,
        company: null,
        status: 'won',
        nextMeetingDate: '',
        dealRating: null,
        assignee: null,
      },
    ]);
  });

  it('counts none when the count returns no row', async () => {
    answerWeek([], []);

    expect((await getWeekMeetings(db(), ORG_ID, NOW)).total).toBe(0);
  });
});

describe('getNextMeetingRate', () => {
  it('reads the first hearings of the organization held in the period, today included', async () => {
    fake.results.push([{ first_meetings: 4, with_next: 3 }]);

    const kpi = await getNextMeetingRate(db(), ORG_ID, 7, NOW);

    expect(kpi).toEqual({
      from: '2026-10-10',
      to: '2026-10-16',
      firstMeetings: 4,
      withNextMeeting: 3,
      rate: 0.75,
    });
    const [call] = fake.calls;
    expect(call.op).toBe('execute');
    const statement = sqlOf(call.statement);
    expect(statement.params).toEqual([ORG_ID, '2026-10-10', '2026-10-16']);
    expect(statement.sql).toContain('where h.organization_id = $1');
    // The first hearing of each lead: the earliest held_on, then created_at, then id
    expect(statement.sql).toContain('select distinct on (h.lead_id)');
    expect(statement.sql).toContain(
      'order by h.lead_id, h.held_on asc, h.created_at asc, h.id asc'
    );
    expect(statement.sql).toContain('where f.held_on between $2 and $3');
  });

  it('gives no rate when there was no first meeting', async () => {
    fake.results.push([]);

    expect(await getNextMeetingRate(db(), ORG_ID, 30, NOW)).toEqual({
      from: '2026-09-17',
      to: '2026-10-16',
      firstMeetings: 0,
      withNextMeeting: 0,
      rate: null,
    });
  });

  it('reads the counts the driver returns as text', async () => {
    fake.results.push([{ first_meetings: '2', with_next: '0' }]);

    expect(await getNextMeetingRate(db(), ORG_ID, 7, NOW)).toMatchObject({
      firstMeetings: 2,
      withNextMeeting: 0,
      rate: 0,
    });
  });
});
