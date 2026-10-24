/**
 * leads.list sorting and filtering (#131) with a mocked database: the WHERE and ORDER BY
 * handed to the database are rendered to SQL and checked. The behaviour on real rows is
 * covered by test/unit/integration/leads-list.db.test.ts.
 */
import {
  escapeLike,
  jstDayEnd,
  jstDayStart,
  leadListOrderBy,
  leadMqlLevel,
  parseUtcTimestamp,
} from '@/lib/features/leads/api/list-sql';
import { LEAD_SORT_KEYS, type LeadSortKey } from '@/lib/features/leads/types/schemas';
import { appRouter } from '@/server/routers/_app';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth/permissions', () => ({
  defineAbilitiesFor: vi.fn(() => ({ can: vi.fn(() => true) })),
}));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const dialect = new PgDialect();
const render = (fragment: SQL | undefined) => {
  if (!fragment) throw new Error('no SQL');
  return dialect.sqlToQuery(fragment);
};

interface FindManyArgs {
  where: SQL;
  extras: Record<string, { sql: SQL }>;
  orderBy: SQL[];
  limit: number;
  offset: number;
}

describe('leads.list (sorting and filtering)', () => {
  let countWhere: SQL | undefined;
  let findManyArgs: FindManyArgs | undefined;
  let total: number;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let caller: any;

  beforeEach(() => {
    countWhere = undefined;
    findManyArgs = undefined;
    total = 3;
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
            return [
              {
                id: 'lead-1',
                organizationId: ORG_ID,
                lastActivityAt: '2026-10-15 12:00:00.5',
                leadTags: [{ tag: { id: 't', name: 'tag' } }],
              },
            ];
          }),
        },
      },
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async (where: SQL) => {
            countWhere = where;
            return [{ total }];
          }),
        })),
      })),
    };
    caller = appRouter.createCaller({
      db,
      session: { id: 's' },
      user: { id: USER_ID, email: 'u@example.com' },
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  });

  async function whereOf(input: Record<string, unknown>) {
    await caller.leads.list({ organizationId: ORG_ID, ...input });
    if (!findManyArgs) throw new Error('findMany was not called');
    return render(findManyArgs.where);
  }

  it('returns the total of all matching leads, the page and the last activity as a date', async () => {
    total = 42;
    const result = await caller.leads.list({ organizationId: ORG_ID, limit: 10, offset: 20 });
    expect(result.total).toBe(42);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(20);
    expect(findManyArgs?.limit).toBe(10);
    expect(findManyArgs?.offset).toBe(20);
    expect(result.items[0].lastActivityAt).toEqual(new Date('2026-10-15T12:00:00.500Z'));
    expect(result.items[0].tags).toEqual([{ id: 't', name: 'tag' }]);
  });

  it('reads the MQL level of each lead in the same query (#196)', async () => {
    await caller.leads.list({ organizationId: ORG_ID });
    const extra = findManyArgs?.extras.mqlLevel;
    expect(extra).toBeDefined();
    expect(render(extra?.sql).sql).toContain(render(leadMqlLevel).sql);
  });

  it('keeps the MQL filter on the MQL date (#196)', async () => {
    expect((await whereOf({ mql: true })).sql).toContain('"leads"."mql_qualified_at" is not null');
    expect((await whereOf({ mql: false })).sql).toContain('"leads"."mql_qualified_at" is null');
  });

  it('counts with the same conditions as the page', async () => {
    await caller.leads.list({ organizationId: ORG_ID, status: ['new'], search: 'abc' });
    expect(render(countWhere)).toEqual(render(findManyArgs?.where));
  });

  describe('organization', () => {
    it.each([
      ['no filter', {}],
      ['search', { search: 'x' }],
      ['every filter', { status: ['new'], inflowSource: ['seminar'], mql: true, scoreMin: 1 }],
    ])('always filters by the organization (%s)', async (_name, input) => {
      const { sql, params } = await whereOf(input);
      // Alone it has no parentheses; with other filters it is the first term of the AND
      expect(sql).toMatch(/^\(?"leads"\."organization_id" = \$1( and |\)?$)/);
      expect(params[0]).toBe(ORG_ID);
      // The count is scoped the same way
      expect(render(countWhere).params[0]).toBe(ORG_ID);
    });

    it('has nothing but the organization when no filter is set', async () => {
      const { sql, params } = await whereOf({});
      expect(sql).toBe('"leads"."organization_id" = $1');
      expect(params).toEqual([ORG_ID]);
    });
  });

  describe('filters', () => {
    const cases: [string, Record<string, unknown>, string, unknown[]][] = [
      ['one status', { status: 'won' }, '"leads"."status" in ($2)', ['won']],
      ['statuses', { status: ['new', 'lost'] }, '"leads"."status" in ($2, $3)', ['new', 'lost']],
      [
        'deal phases',
        { dealPhase: ['proposal', 'ax'] },
        '"leads"."deal_phase" in ($2, $3)',
        ['proposal', 'ax'],
      ],
      [
        'inflow sources',
        { inflowSource: ['seminar'] },
        '"leads"."inflow_source" in ($2)',
        ['seminar'],
      ],
      [
        'target systems',
        { targetSystem: ['as400', 'vb'] },
        '"leads"."target_system" in ($2, $3)',
        ['as400', 'vb'],
      ],
      [
        'score range',
        { scoreMin: 40, scoreMax: 80 },
        '"leads"."score" >= $2 and "leads"."score" <= $3',
        [40, 80],
      ],
      [
        'created days (JST, both ends included)',
        { createdFromDay: '2026-10-13', createdToDay: '2026-10-16' },
        '"leads"."created_at" >= $2 and "leads"."created_at" < $3',
        ['2026-10-12T15:00:00.000Z', '2026-10-16T15:00:00.000Z'],
      ],
      [
        'consultation requested',
        { consultationRequested: true },
        '"leads"."conversion_point" = $2',
        ['consultation'],
      ],
      [
        'no consultation',
        { consultationRequested: false },
        '("leads"."conversion_point" is null or "leads"."conversion_point" <> $2)',
        ['consultation'],
      ],
      ['MQL', { mql: true }, '"leads"."mql_qualified_at" is not null', []],
      ['not MQL', { mql: false }, '"leads"."mql_qualified_at" is null', []],
      ['SQL', { sqlDecision: 'qualified' }, '"leads"."sql_decision" = $2', ['qualified']],
      ['SQL undecided', { sqlDecision: 'undecided' }, '"leads"."sql_decision" is null', []],
      [
        'search (name, email, company; wildcards escaped)',
        { search: ' 100%_ ' },
        '("leads"."name" ilike $2 or "leads"."email" ilike $3 or "leads"."company" ilike $4)',
        ['%100\\%\\_%', '%100\\%\\_%', '%100\\%\\_%'],
      ],
    ];

    it.each(cases)('filters by %s', async (_name, input, fragment, params) => {
      const query = await whereOf(input);
      expect(query.sql).toContain(fragment);
      const rendered = query.params.slice(1).map((p) => (p instanceof Date ? p.toISOString() : p));
      expect(rendered).toEqual(params);
    });

    it('combines filters with AND', async () => {
      const { sql, params } = await whereOf({
        status: ['new', 'won'],
        inflowSource: ['seminar'],
        consultationRequested: true,
        scoreMin: 90,
      });
      expect(sql).toBe(
        '("leads"."organization_id" = $1 and "leads"."status" in ($2, $3) and "leads"."inflow_source" in ($4) and "leads"."score" >= $5 and "leads"."conversion_point" = $6)'
      );
      expect(params).toEqual([ORG_ID, 'new', 'won', 'seminar', 90, 'consultation']);
    });

    it('ignores empty lists and blank search', async () => {
      const { sql } = await whereOf({ status: [], dealPhase: [], search: '   ' });
      expect(sql).toBe('"leads"."organization_id" = $1');
    });

    it.each([
      [{ status: ['unknown'] }],
      [{ inflowSource: ['nope'] }],
      [{ createdFromDay: '2026/10/13' }],
      [{ createdToDay: '2026-13-45' }],
      [{ sortBy: 'phone' }],
      [{ scoreMin: 101 }],
      [{ search: 'x'.repeat(201) }],
    ])('rejects invalid input %j', async (input) => {
      await expect(caller.leads.list({ organizationId: ORG_ID, ...input })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });
  });

  describe('sorting', () => {
    const expected: Record<LeadSortKey, string> = {
      createdAt: '"leads"."created_at"',
      updatedAt: '"leads"."updated_at"',
      name: '"leads"."name"',
      email: '"leads"."email"',
      company: '"leads"."company"',
      score: '"leads"."score"',
      status: '(case "leads"."status" when $1 then 0 when $2 then 1',
      dealPhase: '(case "leads"."deal_phase" when $1 then 0',
      lastActivityAt: 'greatest("leads"."updated_at", (select max(h.updated_at)',
      mqlQualifiedAt: '"leads"."mql_qualified_at"',
      assignee: '(select coalesce(nullif(trim(u.name), \'\'), u.email) from users u',
      // Latest hearing (#137), else the confirmed first meeting (#155)
      nextMeetingDate: "coalesce((select case when (h.fields -> 'nextMeetingDate' ->> 'value') ~",
      dealRating: "(select case when (h.fields -> 'dealRating' ->> 'value') in ('a', 'b', 'c')",
      // "When to act" (#151)
      actBy: '"leads"."act_by"',
      // MQL level of the diagnosis (#447)
      mqlLevel: '(case (case when "leads"."mql_qualified_at" is not null then',
    };

    it.each(LEAD_SORT_KEYS.flatMap((key) => [[key, 'asc'] as const, [key, 'desc'] as const]))(
      'sorts by %s %s with empty values last',
      async (sortBy, sortOrder) => {
        await caller.leads.list({ organizationId: ORG_ID, sortBy, sortOrder });
        const [first] = findManyArgs?.orderBy ?? [];
        const { sql } = render(first);
        expect(sql.startsWith(expected[sortBy])).toBe(true);
        expect(sql.endsWith(` ${sortOrder} nulls last`)).toBe(true);
      }
    );

    it('defaults to newest first, ties broken by id', () => {
      const order = leadListOrderBy().map((part) => render(part).sql);
      expect(order).toEqual(['"leads"."created_at" desc nulls last', '"leads"."id" desc']);
    });

    it('breaks ties by newest first and then id for other keys', () => {
      const order = leadListOrderBy('score', 'asc').map((part) => render(part).sql);
      expect(order).toEqual([
        '"leads"."score" asc nulls last',
        '"leads"."created_at" desc',
        '"leads"."id" desc',
      ]);
    });

    it('sorts statuses and deal phases in pipeline order', () => {
      const status = render(leadListOrderBy('status', 'asc')[0]);
      expect(status.params).toEqual(['new', 'nurturing', 'negotiating', 'won', 'lost']);
      // No ELSE: empty or unknown values are NULL and go last
      expect(status.sql).not.toContain('else');
    });
  });

  describe('helpers', () => {
    it('turns Japan days into instants', () => {
      expect(jstDayStart('2026-10-13').toISOString()).toBe('2026-10-12T15:00:00.000Z');
      expect(jstDayEnd('2026-10-13').toISOString()).toBe('2026-10-13T15:00:00.000Z');
    });

    it('escapes LIKE wildcards', () => {
      expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
    });

    it('reads UTC timestamps from the driver', () => {
      expect(parseUtcTimestamp('2026-10-15 12:00:00')).toEqual(new Date('2026-10-15T12:00:00Z'));
      expect(parseUtcTimestamp(null)).toBeNull();
      expect(parseUtcTimestamp(undefined)).toBeNull();
      expect(parseUtcTimestamp('garbage')).toBeNull();
      const date = new Date();
      expect(parseUtcTimestamp(date)).toBe(date);
    });
  });
});
