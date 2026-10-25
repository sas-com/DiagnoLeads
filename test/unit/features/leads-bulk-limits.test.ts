/**
 * Count limits of the lead inputs (#604): leads.bulkCreate takes up to
 * LEAD_BULK_CREATE_MAX leads (the import sends a larger file in parts of that size), the bulk
 * actions up to a page of the list, and the tag filter as many ids as the other filters take.
 * A count at its limit passes, one over it is refused with BAD_REQUEST before anything is read
 * or written. The advanced filter is gone (#699): leads.list and leads.export ignore it.
 * Values are made up.
 */
import {
  importBatches,
  processImport,
  withoutImportedRows,
} from '@/lib/features/leads/import-service';
import { LEAD_PAGE_SIZES } from '@/lib/features/leads/list-query';
import {
  DEAL_PHASES,
  INFLOW_SOURCES,
  LEAD_STATUSES,
  TARGET_SYSTEMS,
} from '@/lib/features/leads/types/pipeline';
import {
  LEAD_BULK_CREATE_MAX,
  LEAD_FILTER_MAX_VALUES,
  LEAD_LIST_PAGE_MAX,
  bulkCreateSchema,
  bulkDeleteSchema,
  bulkUpdateStatusSchema,
  exportLeadsSchema,
  listLeadsSchema,
} from '@/lib/features/leads/types/schemas';
import { appRouter } from '@/server/routers/_app';
import { TRPCError } from '@trpc/server';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
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

/**
 * An advanced filter as the removed input took it (#699): a value the column cannot take (a
 * text for a date, which made drizzle throw and leads.list answer 500, #688) and groups
 * nested far deeper than the old limit of 3 levels
 */
function oldAdvancedFilter(levels = 10_000): Record<string, unknown> {
  let group: Record<string, unknown> = {
    logic: 'and',
    conditions: [{ field: 'createdAt', operator: 'equals', value: 'x' }],
  };
  for (let level = 1; level < levels; level++) {
    group = {
      logic: 'or',
      conditions: [{ field: 'company', operator: 'contains', value: '三田' }],
      groups: [group],
    };
  }
  return group;
}

const dialect = new PgDialect();

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

describe('the filters given several values (status and the others) of the list and the export', () => {
  const fields = [
    ['status', LEAD_STATUSES[0]],
    ['dealPhase', DEAL_PHASES[0]],
    ['inflowSource', INFLOW_SOURCES[0]],
    ['targetSystem', TARGET_SYSTEMS[0]],
  ] as const;

  it.each(fields)(`%s takes ${LEAD_FILTER_MAX_VALUES} values`, (field, value) => {
    const values = Array(LEAD_FILTER_MAX_VALUES).fill(value);
    expect(listLeadsSchema.parse({ organizationId: ORG_ID, [field]: values })[field]).toEqual(
      values
    );
  });

  it.each(fields)('%s refuses one value more, on the list and on the export', (field, value) => {
    const values = Array(LEAD_FILTER_MAX_VALUES + 1).fill(value);
    expect(
      issuesOf(listLeadsSchema.safeParse({ organizationId: ORG_ID, [field]: values }))
    ).toContainEqual(expect.objectContaining({ path: [field], code: 'too_big' }));
    expect(
      exportLeadsSchema.safeParse({ organizationId: ORG_ID, format: 'csv', [field]: values })
        .success
    ).toBe(false);
  });
});

describe('an advanced filter an older client still sends (#699)', () => {
  // The schema alone drops it, but a procedure's input still carries it: organizationInputSchema
  // passes unknown keys through and tRPC merges the parsed inputs (#743). What keeps it out of
  // the WHERE and the audit row is that they read only named fields, which the leads.list and
  // leads.export tests below check through the procedures.
  it('is dropped by the list and the export schemas, not refused', () => {
    const advancedFilter = oldAdvancedFilter();
    expect(listLeadsSchema.parse({ organizationId: ORG_ID, advancedFilter })).not.toHaveProperty(
      'advancedFilter'
    );
    expect(
      exportLeadsSchema.parse({ organizationId: ORG_ID, format: 'csv', advancedFilter })
    ).not.toHaveProperty('advancedFilter');
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

/** A db whose query builders chain and resolve to nothing; the transaction runs on it */
function mockDb() {
  const db = {
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
    transaction: vi.fn(),
  };
  db.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
  return db;
}

type CallerContext = Parameters<typeof appRouter.createCaller>[0];

describe('tRPC procedures', () => {
  let db: ReturnType<typeof mockDb>;
  let ctx: CallerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    db = mockDb();
    ctx = {
      db,
      session: { id: 'session-1' },
      user: { id: USER_ID, email: 'member@example.jp', name: 'Member' },
    } as unknown as CallerContext;
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

  // createCaller skips superjson. Over HTTP, a nesting of 1,000 to 2,000 levels (Node 22)
  // overflows the stack in superjson's deserialize before zod runs: BAD_REQUEST, not 500
  it('leads.list ignores an advanced filter: the WHERE is the one without it (#699)', async () => {
    const caller = appRouter.createCaller(ctx);
    const input = { organizationId: ORG_ID, status: 'new' as const };
    await caller.leads.list(input);
    // Not an object literal at the call, so the removed key type-checks like an old client's
    const oldInput = { ...input, advancedFilter: oldAdvancedFilter() };
    await expect(caller.leads.list(oldInput)).resolves.toMatchObject({ items: [], total: 0 });

    const wheres = db.query.leads.findMany.mock.calls.map(([args]) =>
      dialect.sqlToQuery(args.where as SQL)
    );
    expect(wheres).toHaveLength(2);
    expect(wheres[0]?.sql).toContain('"leads"."organization_id" = $1');
    expect(wheres[1]).toEqual(wheres[0]);
    // The count reads the same WHERE
    expect(db.where.mock.calls.map(([where]) => dialect.sqlToQuery(where as SQL))).toEqual([
      wheres[0],
      wheres[0],
    ]);
  });

  it('leads.export ignores it too, in the WHERE and in the audit row (#699)', async () => {
    Object.assign(db, {
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });
    const caller = appRouter.createCaller(ctx);
    const input = { organizationId: ORG_ID, format: 'csv' as const, status: 'new' as const };
    await caller.leads.export(input);
    const oldInput = { ...input, advancedFilter: oldAdvancedFilter() };
    await expect(caller.leads.export(oldInput)).resolves.toMatchObject({ rowCount: 0 });

    // The count and the rows of each export
    const wheres = db.where.mock.calls.map(([where]) => dialect.sqlToQuery(where as SQL));
    expect(wheres).toHaveLength(4);
    expect(wheres[0]?.sql).toContain('"leads"."organization_id" = $1');
    for (const where of wheres) expect(where).toEqual(wheres[0]);
    expect(db.values.mock.calls.map(([row]) => row.metadata.filters)).toEqual([
      { status: 'new' },
      { status: 'new' },
    ]);
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
