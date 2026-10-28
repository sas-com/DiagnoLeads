/**
 * The contact records a member made on a Japan day (lib/features/lead-activity/service.ts
 * listMyContactsOfDay, 今日 #556) without a database: the instants the day runs between, that the
 * records, their leads and their deals are of the organization and the member, and how the counts
 * and the rows are shaped. The rows the SQL matches on a real PostgreSQL (the day's boundaries,
 * other organizations, colleagues) are covered by
 * test/unit/integration/today-org-isolation.db.test.ts.
 */
import { deals, leadContactLogs, leads } from '@/lib/db/schema';
import { listMyContactsOfDay } from '@/lib/features/lead-activity/service';
import { MY_DAY_CONTACTS_LIMIT } from '@/lib/features/lead-activity/types/schemas';
import { type QueryCall, type RecordingDb, recordingDb, sqlOf } from '@/test/mocks/recording-db';
import { beforeEach, describe, expect, it } from 'vitest';

type Database = Parameters<typeof listMyContactsOfDay>[0];

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440001';
const DEAL_ID = '880e8400-e29b-41d4-a716-446655440001';

let fake: RecordingDb;
const db = () => fake.db as unknown as Database;

/** The counts, told from the list by their grouping */
const isCounts = (call: QueryCall) => (call.groupBy?.length ?? 0) > 0;

/** Answers the list and the counts by their shape (they run side by side) */
const answer = (list: unknown[], counts: unknown[]) => {
  fake = recordingDb((call) => (isCounts(call) ? counts : list));
};

const input = (hideDeals = false) => ({
  organizationId: ORG_ID,
  userId: USER_ID,
  day: '2026-10-29',
  hideDeals,
});

const row = {
  id: 'contact-1',
  kind: 'visit',
  note: '現行の帳票を見せてもらった',
  createdBy: USER_ID,
  contactedAt: new Date('2026-10-29T01:00:00Z'),
  durationMinutes: 90,
  outcome: 'advanced',
  dealId: DEAL_ID,
  dealName: '基幹システム移行',
  leadId: LEAD_ID,
  leadName: '山田 太郎',
  company: '架空商事',
};

beforeEach(() => {
  fake = recordingDb();
});

describe('listMyContactsOfDay', () => {
  it('reads the member’s records of the organization from 0:00 to the next 0:00 in Japan', async () => {
    answer([], []);

    await listMyContactsOfDay(db(), input());

    expect(fake.calls).toHaveLength(2);
    for (const call of fake.calls) {
      expect(call.table).toBe(leadContactLogs);
      const where = sqlOf(call.where);
      expect(where.sql).toBe(
        '("lead_contact_logs"."organization_id" = $1 and "lead_contact_logs"."created_by" = $2 and "lead_contact_logs"."contacted_at" >= $3 and "lead_contact_logs"."contacted_at" < $4)'
      );
      expect(where.params).toEqual([
        ORG_ID,
        USER_ID,
        new Date('2026-10-28T15:00:00.000Z').toISOString(),
        new Date('2026-10-29T15:00:00.000Z').toISOString(),
      ]);
      // The lead, of the same organization
      expect(call.joins[0]).toMatchObject({ type: 'inner', table: leads });
      expect(sqlOf(call.joins[0].on)).toEqual({
        sql: '("leads"."id" = "lead_contact_logs"."lead_id" and "leads"."organization_id" = $1)',
        params: [ORG_ID],
      });
    }
  });

  it('lists the newest first with the deal of the same organization, up to the limit', async () => {
    answer([], []);

    await listMyContactsOfDay(db(), input());

    const list = fake.calls.find((call) => !isCounts(call));
    expect(list?.limit).toBe(MY_DAY_CONTACTS_LIMIT);
    expect(list?.orderBy).toHaveLength(2);
    expect(list?.joins[1]).toMatchObject({ type: 'left', table: deals });
    expect(sqlOf(list?.joins[1].on)).toEqual({
      sql: '("deals"."id" = "lead_contact_logs"."deal_id" and "deals"."organization_id" = $1)',
      params: [ORG_ID],
    });
  });

  it('counts every kind, with 0 for those without records, and sums the minutes', async () => {
    answer(
      [],
      [
        { kind: 'call', count: 2, minutes: '30' },
        { kind: 'no_answer', count: 1, minutes: 0 },
        { kind: 'visit', count: 1, minutes: 90 },
      ]
    );

    const result = await listMyContactsOfDay(db(), input());

    expect(result).toEqual({
      day: '2026-10-29',
      total: 4,
      byKind: { call: 2, email: 0, visit: 1, online_meeting: 0, no_answer: 1 },
      durationMinutes: 120,
      items: [],
    });
  });

  it('gives each record with its lead, as the timeline shows it', async () => {
    answer([row], [{ kind: 'visit', count: 1, minutes: 90 }]);

    const result = await listMyContactsOfDay(db(), input());

    expect(result.items).toEqual([
      {
        lead: { id: LEAD_ID, name: '山田 太郎', company: '架空商事' },
        event: {
          id: 'contact:contact-1',
          kind: 'contact_recorded',
          at: row.contactedAt,
          actor: null,
          contactId: 'contact-1',
          contactKind: 'visit',
          note: '現行の帳票を見せてもらった',
          durationMinutes: 90,
          outcome: 'advanced',
          deal: { id: DEAL_ID, name: '基幹システム移行' },
          first: false,
        },
      },
    ]);
  });

  it('leaves the deal out for those who may not read deals', async () => {
    answer([row], [{ kind: 'visit', count: 1, minutes: 90 }]);

    const result = await listMyContactsOfDay(db(), input(true));

    expect(result.items[0].event.deal).toBeNull();
  });
});
