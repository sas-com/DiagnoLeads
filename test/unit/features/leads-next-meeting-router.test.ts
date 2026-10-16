/**
 * Latest hearing in the lead list (#137) and the server export (#173) with a mocked database:
 * the SQL handed to the database is rendered and checked. Real rows are covered by
 * test/unit/integration/lead-meetings-export.db.test.ts.
 */
import { leadNextMeetingDate, nextMeetingCondition } from '@/lib/features/leads/api/list-sql';
import { appRouter } from '@/server/routers/_app';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ability = vi.hoisted(() => ({ canRead: true }));
vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth/permissions', () => ({
  defineAbilitiesFor: vi.fn(() => ({
    can: vi.fn((action: string) => (action === 'read' ? ability.canRead : true)),
  })),
}));
// The PDF itself is tested with the report service
vi.mock('@/lib/features/leads/export-pdf', () => ({
  leadExportPdfBase64: vi.fn(() => 'JVBERi0='),
}));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const dialect = new PgDialect();
const render = (fragment: SQL | undefined) => {
  if (!fragment) throw new Error('no SQL');
  return dialect.sqlToQuery(fragment);
};

// Thursday 2026-10-15 23:30 JST (14:30 UTC): the week is Mon 10-12 to Sun 10-18
const NOW = new Date('2026-10-15T14:30:00Z');

interface FindManyArgs {
  where: SQL;
  orderBy: SQL[];
  extras: Record<string, unknown>;
}

describe('latest hearing in leads.list (#137) and leads.export (#173)', () => {
  let findManyArgs: FindManyArgs | undefined;
  let exportArgs: { where?: SQL; orderBy?: SQL[]; limit?: number };
  let exportRows: Record<string, unknown>[];
  let total: number;
  let audit: Record<string, unknown> | undefined;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let caller: any;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    ability.canRead = true;
    findManyArgs = undefined;
    exportArgs = {};
    exportRows = [];
    total = 0;
    audit = undefined;
    const db = {
      query: {
        organizationMembers: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'm',
            organizationId: ORG_ID,
            userId: USER_ID,
            role: 'admin',
            organization: { id: ORG_ID },
          }),
        },
        leads: {
          findMany: vi.fn(async (args: FindManyArgs) => {
            findManyArgs = args;
            return [];
          }),
        },
      },
      // count: select().from().where(); export rows: select().from().leftJoin().where().orderBy().limit()
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [{ total }]),
          leftJoin: vi.fn(() => ({
            where: vi.fn((where: SQL) => {
              exportArgs.where = where;
              return {
                orderBy: vi.fn((...orderBy: SQL[]) => {
                  exportArgs.orderBy = orderBy;
                  return {
                    limit: vi.fn(async (limit: number) => {
                      exportArgs.limit = limit;
                      return exportRows;
                    }),
                  };
                }),
              };
            }),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(async (values: Record<string, unknown>) => {
          audit = values;
        }),
      })),
    };
    caller = appRouter.createCaller({
      db,
      session: { id: 's' },
      user: { id: USER_ID, email: 'u@example.com' },
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  });

  afterEach(() => vi.useRealTimers());

  async function whereOf(input: Record<string, unknown>) {
    await caller.leads.list({ organizationId: ORG_ID, ...input });
    if (!findManyArgs) throw new Error('findMany was not called');
    return render(findManyArgs.where);
  }

  const latest = render(leadNextMeetingDate).sql;

  describe('latest hearing value', () => {
    it('reads the latest hearing of the same lead and organization only', () => {
      expect(latest).toContain('from lead_hearings h where h.lead_id = "leads"."id"');
      expect(latest).toContain('and h.organization_id = "leads"."organization_id"');
      expect(latest).toContain('order by h.held_on desc, h.created_at desc, h.id desc limit 1');
      // Only well-formed dates
      expect(latest).toContain("~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'");
    });

    it('is returned with each lead of the list and the lead page', async () => {
      await caller.leads.list({ organizationId: ORG_ID });
      expect(Object.keys(findManyArgs?.extras ?? {})).toEqual(
        expect.arrayContaining(['lastActivityAt', 'nextMeetingDate', 'dealRating'])
      );
    });
  });

  describe('filters', () => {
    it.each([
      ['has', `${latest} is not null`, []],
      ['none', `${latest} is null`, []],
      // Open leads only: won and lost are left out
      ['overdue', `(${latest} < $2 and "leads"."status" not in ($3, $4))`, ['2026-10-15', 'won', 'lost']],
      ['thisWeek', `${latest} between $2 and $3`, ['2026-10-12', '2026-10-18']],
    ])('next meeting %s (Japan days)', async (nextMeeting, sql, params) => {
      const result = await whereOf({ nextMeeting });
      expect(result.sql).toBe(`("leads"."organization_id" = $1 and ${sql})`);
      expect(result.params).toEqual([ORG_ID, ...params]);
    });

    it('takes "today" in Japan time: 00:30 JST is already the next day', () => {
      const { params } = render(
        nextMeetingCondition('overdue', new Date('2026-10-18T15:30:00Z')) as SQL
      );
      expect(params).toEqual(['2026-10-19', 'won', 'lost']);
      // Monday 00:30 JST starts a new week
      const week = render(nextMeetingCondition('thisWeek', new Date('2026-10-18T15:30:00Z')) as SQL);
      expect(week.params).toEqual(['2026-10-19', '2026-10-25']);
    });

    it('rating: any of the chosen values of the latest hearing', async () => {
      const { sql, params } = await whereOf({ dealRating: ['a', 'c'] });
      expect(sql).toMatch(/^\("leads"\."organization_id" = \$1 and \(select case when /);
      expect(sql).toContain("(h.fields -> 'dealRating' ->> 'value') in ('a', 'b', 'c')");
      expect(sql.endsWith(' in ($2, $3))')).toBe(true);
      expect(params).toEqual([ORG_ID, 'a', 'c']);
    });

    it('rejects unknown values', async () => {
      await expect(
        caller.leads.list({ organizationId: ORG_ID, nextMeeting: 'tomorrow' })
      ).rejects.toThrow();
      await expect(caller.leads.list({ organizationId: ORG_ID, dealRating: ['d'] })).rejects.toThrow();
    });
  });

  describe('leads.export', () => {
    const row = (id: string) => ({
      id,
      name: '山田 太郎',
      email: `${id}@example.jp`,
      company: '架空製作所',
      phone: null,
      status: 'new',
      dealPhase: null,
      score: 70,
      source: 'diagnostic',
      inflowSource: null,
      assignee: '佐藤 花子',
      nextMeetingDate: '2026-10-20',
      dealRating: 'a',
      createdAt: new Date('2026-10-01T00:00:00Z'),
    });

    it('writes every matching lead with the list conditions and sort, up to 5,000 rows', async () => {
      exportRows = [row('l1'), row('l2')];
      total = 2;
      const result = await caller.leads.export({
        organizationId: ORG_ID,
        format: 'csv',
        status: ['new'],
        nextMeeting: 'thisWeek',
        search: '山田',
        sortBy: 'nextMeetingDate',
        sortOrder: 'asc',
      });
      expect(exportArgs.limit).toBe(5000);
      const where = render(exportArgs.where);
      expect(where.sql.startsWith('("leads"."organization_id" = $1 and')).toBe(true);
      expect(where.params[0]).toBe(ORG_ID);
      expect(where.params).toEqual(expect.arrayContaining(['new', '%山田%', '2026-10-12']));
      expect(render(exportArgs.orderBy?.[0]).sql.startsWith(latest)).toBe(true);

      expect(result).toMatchObject({
        format: 'csv',
        filename: 'leads_2026-10-15.csv',
        encoding: 'utf8',
        rowCount: 2,
        total: 2,
        capped: false,
        maxRows: 5000,
      });
      expect(result.content.split('\r\n')).toHaveLength(4); // header, 2 rows, final newline
    });

    it('says when the matching leads are more than the limit', async () => {
      exportRows = [row('l1')];
      total = 7000;
      const result = await caller.leads.export({ organizationId: ORG_ID, format: 'json' });
      expect(result).toMatchObject({ capped: true, total: 7000, rowCount: 1 });
      expect(JSON.parse(result.content)[0]).toMatchObject({ id: 'l1', dealRating: 'a' });
    });

    it('logs who exported what, without personal data', async () => {
      exportRows = [row('l1')];
      total = 1;
      await caller.leads.export({
        organizationId: ORG_ID,
        format: 'pdf',
        search: 'yamada@example.jp',
        dealRating: ['a'],
      });
      expect(audit).toMatchObject({
        organizationId: ORG_ID,
        userId: USER_ID,
        action: 'export',
        resource: 'lead',
        resourceId: null,
        metadata: {
          format: 'pdf',
          rowCount: 1,
          total: 1,
          capped: false,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          filters: { search: true, dealRating: ['a'] },
        },
      });
      const logged = JSON.stringify(audit);
      expect(logged).not.toContain('yamada');
      expect(logged).not.toContain('山田');
      expect(logged).not.toContain('example.jp');
    });

    it('needs the same permission as the list', async () => {
      ability.canRead = false;
      await expect(caller.leads.export({ organizationId: ORG_ID, format: 'csv' })).rejects.toThrow(
        'リードを閲覧する権限がありません'
      );
      expect(audit).toBeUndefined();
    });

    it('rejects an unknown format', async () => {
      await expect(caller.leads.export({ organizationId: ORG_ID, format: 'xlsx' })).rejects.toThrow();
    });
  });
});
