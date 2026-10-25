/**
 * Count, nesting and length limits of the lead inputs (#604): leads.bulkCreate takes up to
 * LEAD_BULK_CREATE_MAX leads (the import sends a larger file in parts of that size), the bulk
 * actions up to a page of the list, the tag filter as many ids as the other filters take, and
 * the advanced filter LEAD_FILTER_LIMITS. A count at its limit passes, one over it is refused
 * with BAD_REQUEST before anything is read or written. Values are made up.
 */
import {
  importBatches,
  processImport,
  withoutImportedRows,
} from '@/lib/features/leads/import-service';
import { LEAD_PAGE_SIZES } from '@/lib/features/leads/list-query';
import {
  type FilterGroup,
  LEAD_BULK_CREATE_MAX,
  LEAD_FILTER_LIMITS,
  LEAD_FILTER_MAX_VALUES,
  LEAD_LIST_PAGE_MAX,
  bulkCreateSchema,
  bulkDeleteSchema,
  bulkUpdateStatusSchema,
  exportLeadsSchema,
  filterGroupSchema,
  listLeadsSchema,
} from '@/lib/features/leads/types/schemas';
import { appRouter } from '@/server/routers/_app';
import { TRPCError } from '@trpc/server';
import type { ZodError } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth/permissions', () => ({
  defineAbilitiesFor: vi.fn(() => ({ can: vi.fn(() => true) })),
}));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';

/** `count` distinct ids */
const idsOf = (count: number) =>
  Array.from({ length: count }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

/** `count` import rows, each with its own address */
const leadsOf = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ email: `lead${i}@example.jp` }));

/** A condition of the advanced filter */
const condition = (value: unknown = '三田') => ({ field: 'company', operator: 'contains', value });

/** A filter of `levels` levels of groups: each group holds one condition and the next group */
function nestedFilter(levels: number): Record<string, unknown> {
  let group: Record<string, unknown> = { logic: 'and', conditions: [condition()] };
  for (let level = 1; level < levels; level++) {
    group = { logic: 'or', conditions: [condition()], groups: [group] };
  }
  return group;
}

/** The issues of a refused parse */
function issuesOf(result: { success: boolean; error?: ZodError }) {
  expect(result.success).toBe(false);
  return result.error?.issues ?? [];
}

describe('leads.bulkCreate: the leads of one request', () => {
  it(`takes ${LEAD_BULK_CREATE_MAX} leads`, () => {
    const parsed = bulkCreateSchema.parse({
      organizationId: ORG_ID,
      leads: leadsOf(LEAD_BULK_CREATE_MAX),
    });
    expect(parsed.leads).toHaveLength(LEAD_BULK_CREATE_MAX);
  });

  it('refuses one lead more, saying how many one import takes', () => {
    const issues = issuesOf(
      bulkCreateSchema.safeParse({
        organizationId: ORG_ID,
        leads: leadsOf(LEAD_BULK_CREATE_MAX + 1),
      })
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        path: ['leads'],
        code: 'too_big',
        message: `一度に取り込めるリードは${LEAD_BULK_CREATE_MAX}件までです`,
      })
    );
  });
});

describe('leads.bulkUpdateStatus and leads.bulkDelete: the selected leads', () => {
  it('take as many leads as the largest page of the list shows, since only that page is selected', () => {
    expect(Math.max(...LEAD_PAGE_SIZES)).toBeLessThanOrEqual(LEAD_LIST_PAGE_MAX);
    expect(
      listLeadsSchema.safeParse({ organizationId: ORG_ID, limit: LEAD_LIST_PAGE_MAX }).success
    ).toBe(true);
  });

  it.each([
    ['bulkUpdateStatus', bulkUpdateStatusSchema, { status: 'nurturing' }],
    ['bulkDelete', bulkDeleteSchema, {}],
  ] as const)('%s takes a full page of ids', (_name, schema, rest) => {
    const parsed = schema.parse({
      organizationId: ORG_ID,
      ids: idsOf(LEAD_LIST_PAGE_MAX),
      ...rest,
    });
    expect(parsed.ids).toHaveLength(LEAD_LIST_PAGE_MAX);
  });

  it.each([
    ['bulkUpdateStatus', bulkUpdateStatusSchema, { status: 'nurturing' }],
    ['bulkDelete', bulkDeleteSchema, {}],
  ] as const)('%s refuses one id more', (_name, schema, rest) => {
    const issues = issuesOf(
      schema.safeParse({ organizationId: ORG_ID, ids: idsOf(LEAD_LIST_PAGE_MAX + 1), ...rest })
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        path: ['ids'],
        code: 'too_big',
        message: `一度に選べるリードは${LEAD_LIST_PAGE_MAX}件までです`,
      })
    );
  });

  it('still refuses an empty selection', () => {
    const issues = issuesOf(bulkDeleteSchema.safeParse({ organizationId: ORG_ID, ids: [] }));
    expect(issues[0]?.message).toBe('少なくとも1つのリードを選択してください');
  });
});

describe('the tag filter of the list and the export', () => {
  it('takes as many tag ids as the other filters take values', () => {
    const tagIds = idsOf(LEAD_FILTER_MAX_VALUES);
    expect(listLeadsSchema.parse({ organizationId: ORG_ID, tagIds }).tagIds).toEqual(tagIds);
    expect(
      listLeadsSchema.safeParse({ organizationId: ORG_ID, status: Array(50).fill('new') }).success
    ).toBe(true);
  });

  it('refuses one tag id more, on the list and on the export', () => {
    const tagIds = idsOf(LEAD_FILTER_MAX_VALUES + 1);
    expect(issuesOf(listLeadsSchema.safeParse({ organizationId: ORG_ID, tagIds }))).toContainEqual(
      expect.objectContaining({ path: ['tagIds'], code: 'too_big' })
    );
    expect(
      exportLeadsSchema.safeParse({ organizationId: ORG_ID, format: 'csv', tagIds }).success
    ).toBe(false);
  });
});

describe('the advanced filter', () => {
  describe('nesting', () => {
    it(`takes groups ${LEAD_FILTER_LIMITS.depth} levels deep`, () => {
      const filter = nestedFilter(LEAD_FILTER_LIMITS.depth);
      expect(filterGroupSchema.parse(filter)).toEqual(filter);
    });

    it('refuses a group one level deeper, where the limit is reached', () => {
      const issues = issuesOf(
        filterGroupSchema.safeParse(nestedFilter(LEAD_FILTER_LIMITS.depth + 1))
      );
      expect(issues).toContainEqual(
        expect.objectContaining({
          path: ['groups', 0, 'groups', 0, 'groups'],
          message: `条件のグループは${LEAD_FILTER_LIMITS.depth}段までです`,
        })
      );
    });

    it('refuses a filter nested 100,000 levels deep without overflowing the stack', () => {
      // The recursive schema threw a RangeError at about 800 levels
      const result = filterGroupSchema.safeParse(nestedFilter(100_000));
      expect(result.success).toBe(false);
    });

    it(`takes ${LEAD_FILTER_LIMITS.groups} groups in one group and refuses one more`, () => {
      const withGroups = (count: number) => ({
        logic: 'or',
        conditions: [],
        groups: Array.from({ length: count }, () => ({ logic: 'and', conditions: [condition()] })),
      });
      expect(filterGroupSchema.safeParse(withGroups(LEAD_FILTER_LIMITS.groups)).success).toBe(true);
      expect(
        issuesOf(filterGroupSchema.safeParse(withGroups(LEAD_FILTER_LIMITS.groups + 1)))
      ).toContainEqual(expect.objectContaining({ path: ['groups'], code: 'too_big' }));
    });
  });

  describe('conditions', () => {
    /** `count` conditions spread over the top group and two nested levels */
    function spread(count: number): FilterGroup {
      const third = Math.floor(count / 3);
      const conditions = (n: number) =>
        Array.from({ length: n }, () => condition() as FilterGroup['conditions'][number]);
      return {
        logic: 'and',
        conditions: conditions(count - 2 * third),
        groups: [
          {
            logic: 'or',
            conditions: conditions(third),
            groups: [{ logic: 'and', conditions: conditions(third) }],
          },
        ],
      };
    }

    it(`takes ${LEAD_FILTER_LIMITS.conditions} conditions over the whole filter`, () => {
      expect(filterGroupSchema.safeParse(spread(LEAD_FILTER_LIMITS.conditions)).success).toBe(true);
    });

    it('refuses one condition more, counting every group', () => {
      const issues = issuesOf(
        filterGroupSchema.safeParse(spread(LEAD_FILTER_LIMITS.conditions + 1))
      );
      expect(issues).toContainEqual(
        expect.objectContaining({
          message: `条件は全体で${LEAD_FILTER_LIMITS.conditions}個までです`,
        })
      );
    });

    it('refuses one group holding more conditions than the whole filter takes', () => {
      const issues = issuesOf(
        filterGroupSchema.safeParse({
          logic: 'and',
          conditions: Array.from({ length: LEAD_FILTER_LIMITS.conditions + 1 }, () => condition()),
        })
      );
      expect(issues).toContainEqual(
        expect.objectContaining({ path: ['conditions'], code: 'too_big' })
      );
    });
  });

  describe('fields and values', () => {
    const parse = (overrides: Record<string, unknown>) =>
      filterGroupSchema.safeParse({ logic: 'and', conditions: [{ ...condition(), ...overrides }] });

    it(`takes a field name of ${LEAD_FILTER_LIMITS.fieldLength} characters and refuses one more`, () => {
      expect(parse({ field: 'f'.repeat(LEAD_FILTER_LIMITS.fieldLength) }).success).toBe(true);
      expect(
        issuesOf(parse({ field: 'f'.repeat(LEAD_FILTER_LIMITS.fieldLength + 1) }))[0]
      ).toMatchObject({
        path: ['conditions', 0, 'field'],
        code: 'too_big',
      });
    });

    it(`takes a text value of ${LEAD_FILTER_LIMITS.valueLength} characters and refuses one more`, () => {
      expect(parse({ value: '株'.repeat(LEAD_FILTER_LIMITS.valueLength) }).success).toBe(true);
      expect(parse({ value: '株'.repeat(LEAD_FILTER_LIMITS.valueLength + 1) }).success).toBe(false);
      expect(
        parse({
          operator: 'between',
          value: 1,
          value2: 'x'.repeat(LEAD_FILTER_LIMITS.valueLength + 1),
        }).success
      ).toBe(false);
    });

    it(`takes a list of ${LEAD_FILTER_LIMITS.values} values and refuses one more`, () => {
      const list = (count: number) => Array.from({ length: count }, (_, i) => `会社${i}`);
      expect(parse({ operator: 'in', value: list(LEAD_FILTER_LIMITS.values) }).success).toBe(true);
      expect(parse({ operator: 'in', value: list(LEAD_FILTER_LIMITS.values + 1) }).success).toBe(
        false
      );
    });

    it('refuses values that are neither text, a number, a boolean, a date nor a list of them', () => {
      expect(parse({ operator: 'in', value: [['nested']] }).success).toBe(false);
      expect(parse({ value: { company: '三田' } }).success).toBe(false);
      expect(parse({ value: Number.POSITIVE_INFINITY }).success).toBe(false);
    });

    it('still takes the shapes the operators use', () => {
      const filter = {
        logic: 'and' as const,
        conditions: [
          { field: 'status', operator: 'equals' as const, value: 'new' },
          { field: 'score', operator: 'between' as const, value: 10, value2: 90 },
          {
            field: 'createdAt',
            operator: 'greater_than' as const,
            value: new Date('2026-10-01T00:00:00Z'),
          },
          { field: 'source', operator: 'in' as const, value: ['website', 'embed'] },
          { field: 'phone', operator: 'is_empty' as const },
          { field: 'company', operator: 'not_equals' as const, value: null },
        ],
      };
      expect(filterGroupSchema.parse(filter)).toEqual(filter);
    });
  });
});

describe('the import of a file larger than one request', () => {
  const mapping = { email: 'email' };

  it(`sends ${LEAD_BULK_CREATE_MAX} leads a request, in the file's order, leaving out the rows with an error`, () => {
    const rows = [...leadsOf(2_500), { email: 'not-an-email' }];
    const batches = importBatches(processImport(rows, mapping));

    expect(batches.map((batch) => batch.length)).toEqual([1_000, 1_000, 500]);
    expect(batches[0]?.[0]?.email).toBe('lead0@example.jp');
    expect(batches[2]?.[499]?.email).toBe('lead2499@example.jp');
    for (const leads of batches) {
      expect(bulkCreateSchema.safeParse({ organizationId: ORG_ID, leads }).success).toBe(true);
    }
  });

  it(`sends a file of exactly ${LEAD_BULK_CREATE_MAX} leads in one request`, () => {
    expect(importBatches(processImport(leadsOf(LEAD_BULK_CREATE_MAX), mapping))).toHaveLength(1);
  });

  it('keeps the rows not created yet and the rows with an error after a part fails', () => {
    const summary = processImport(
      [
        { email: 'a@example.jp' },
        { email: 'bad' },
        { email: 'b@example.jp' },
        { email: 'c@example.jp' },
      ],
      mapping
    );

    // The first two valid rows (a, b) were created before the failure
    const left = withoutImportedRows(summary, 2);

    expect(left).toMatchObject({ totalRows: 2, successCount: 1, errorCount: 1 });
    expect(left.results.map((result) => result.row)).toEqual([2, 4]);
    expect(importBatches(left)).toEqual([[expect.objectContaining({ email: 'c@example.jp' })]]);
  });
});

describe('tRPC procedures', () => {
  let db: any;
  let ctx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    db = {
      query: {
        organizationMembers: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'member-1',
            organizationId: ORG_ID,
            userId: USER_ID,
            role: 'admin',
            organization: { id: ORG_ID, name: 'Org', slug: 'org', settings: {} },
          }),
        },
        leads: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      },
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
    };
    db.transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(db));
    ctx = {
      db,
      session: { id: 'session-1' },
      user: { id: USER_ID, email: 'member@example.jp', name: 'Member' },
    };
  });

  /** The procedure's refusal: BAD_REQUEST carrying the zod issues of the input */
  async function refusal(call: Promise<unknown>) {
    const error = await call.then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({ code: 'BAD_REQUEST' });
    return ((error as TRPCError).cause as ZodError).issues;
  }

  it(`leads.bulkCreate inserts ${LEAD_BULK_CREATE_MAX} leads in one statement`, async () => {
    await appRouter.createCaller(ctx).leads.bulkCreate({
      organizationId: ORG_ID,
      leads: leadsOf(LEAD_BULK_CREATE_MAX),
    });
    expect(db.values).toHaveBeenCalledWith(expect.any(Array));
    expect(db.values.mock.calls[0]?.[0]).toHaveLength(LEAD_BULK_CREATE_MAX);
  });

  it('leads.bulkCreate refuses one lead more and writes nothing', async () => {
    const issues = await refusal(
      appRouter.createCaller(ctx).leads.bulkCreate({
        organizationId: ORG_ID,
        leads: leadsOf(LEAD_BULK_CREATE_MAX + 1),
      })
    );
    expect(issues[0]).toMatchObject({ path: ['leads'], code: 'too_big' });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('leads.bulkUpdateStatus updates a full page of leads', async () => {
    await appRouter.createCaller(ctx).leads.bulkUpdateStatus({
      organizationId: ORG_ID,
      ids: idsOf(LEAD_LIST_PAGE_MAX),
      status: 'nurturing',
    });
    expect(db.update).toHaveBeenCalled();
  });

  it('leads.bulkUpdateStatus refuses one lead more and changes nothing', async () => {
    const issues = await refusal(
      appRouter.createCaller(ctx).leads.bulkUpdateStatus({
        organizationId: ORG_ID,
        ids: idsOf(LEAD_LIST_PAGE_MAX + 1),
        status: 'nurturing',
      })
    );
    expect(issues[0]).toMatchObject({ path: ['ids'], code: 'too_big' });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('leads.bulkDelete deletes a full page of leads', async () => {
    await appRouter.createCaller(ctx).leads.bulkDelete({
      organizationId: ORG_ID,
      ids: idsOf(LEAD_LIST_PAGE_MAX),
    });
    expect(db.delete).toHaveBeenCalled();
  });

  it('leads.bulkDelete refuses one lead more and deletes nothing', async () => {
    const issues = await refusal(
      appRouter.createCaller(ctx).leads.bulkDelete({
        organizationId: ORG_ID,
        ids: idsOf(LEAD_LIST_PAGE_MAX + 1),
      })
    );
    expect(issues[0]).toMatchObject({ path: ['ids'], code: 'too_big' });
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('leads.list refuses a deeply nested advanced filter with the zod issue, not a stack overflow', async () => {
    const issues = await refusal(
      appRouter.createCaller(ctx).leads.list({
        organizationId: ORG_ID,
        advancedFilter: nestedFilter(10_000) as FilterGroup,
      })
    );
    expect(issues[0]?.path.slice(0, 1)).toEqual(['advancedFilter']);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('leads.list refuses one tag id more before reading the tags', async () => {
    const issues = await refusal(
      appRouter.createCaller(ctx).leads.list({
        organizationId: ORG_ID,
        tagIds: idsOf(LEAD_FILTER_MAX_VALUES + 1),
      })
    );
    expect(issues[0]).toMatchObject({ path: ['tagIds'], code: 'too_big' });
    expect(db.select).not.toHaveBeenCalled();
  });
});
