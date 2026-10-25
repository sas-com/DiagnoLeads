/**
 * Nesting, count and length limits of the saved filters (#669): filters.create and
 * filters.update take a filter within SAVED_FILTER_LIMITS (the numbers of #604). A filter at a
 * limit is stored; one over it is refused with BAD_REQUEST carrying the zod issues, before
 * anything is written. A filter nested thousands of levels deep is refused the same way by zod,
 * not with the RangeError of the recursive schema it replaced. The procedures are called with
 * createCaller, so the input skips the superjson transformer of an HTTP request. Values are made
 * up.
 */
import { SAVED_FILTER_LIMITS } from '@/lib/features/filters/types/schemas';
import { appRouter } from '@/server/routers/_app';
import { TRPCError } from '@trpc/server';
import { ZodError, type ZodIssue } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth/permissions', () => ({
  defineAbilitiesFor: vi.fn(() => ({ can: vi.fn(() => true) })),
}));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const FILTER_ID = '880e8400-e29b-41d4-a716-446655440000';

type Filters = Record<string, unknown>;

/** A condition of a saved filter */
const condition = (overrides: Record<string, unknown> = {}) => ({
  field: 'company',
  operator: 'contains',
  value: '三田',
  ...overrides,
});

/** A filter of `levels` levels of groups: each group holds one condition and the next group */
function nestedFilter(levels: number): Filters {
  let group: Filters = { logic: 'and', conditions: [condition()] };
  for (let level = 1; level < levels; level++) {
    group = { logic: 'or', conditions: [condition()], groups: [group] };
  }
  return group;
}

/** A filter with `count` groups directly in the top group */
const withGroups = (count: number): Filters => ({
  logic: 'or',
  conditions: [],
  groups: Array.from({ length: count }, () => ({ logic: 'and', conditions: [condition()] })),
});

/** `count` conditions spread over the top group and two nested levels */
function spread(count: number): Filters {
  const third = Math.floor(count / 3);
  const conditions = (n: number) => Array.from({ length: n }, () => condition());
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

/** A filter of one condition */
const oneCondition = (overrides: Record<string, unknown>): Filters => ({
  logic: 'and',
  conditions: [condition(overrides)],
});

/** A list of `count` text values */
const list = (count: number) => Array.from({ length: count }, (_, i) => `会社${i}`);

/** A db whose query builders chain; the filter to update belongs to the caller */
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
      savedFilters: {
        findFirst: vi.fn().mockResolvedValue({
          id: FILTER_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
        }),
      },
    },
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: FILTER_ID }]),
  };
  return db;
}

type CallerContext = Parameters<typeof appRouter.createCaller>[0];

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

// The tests send shapes the input type does not allow (that is what they check)
type CreateInput = Parameters<ReturnType<typeof appRouter.createCaller>['filters']['create']>[0];
type UpdateInput = Parameters<ReturnType<typeof appRouter.createCaller>['filters']['update']>[0];

const create = (filters: Filters) =>
  appRouter.createCaller(ctx).filters.create({
    organizationId: ORG_ID,
    name: '関東の製造業',
    filters,
  } as unknown as CreateInput);

const update = (filters: Filters) =>
  appRouter.createCaller(ctx).filters.update({
    organizationId: ORG_ID,
    id: FILTER_ID,
    filters,
  } as unknown as UpdateInput);

/** The procedure's refusal: BAD_REQUEST carrying the zod issues of the input */
async function refusal(call: Promise<unknown>): Promise<ZodIssue[]> {
  const error = await call.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(TRPCError);
  expect(error).toMatchObject({ code: 'BAD_REQUEST' });
  const cause = (error as TRPCError).cause;
  expect(cause).toBeInstanceOf(ZodError);
  return (cause as ZodError).issues;
}

/** filters.create stores the filter as sent */
async function expectStored(filters: Filters) {
  await create(filters);
  expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ filters }));
}

/** Both procedures refuse the filter with an issue like `issue`, and write nothing */
async function expectRefused(filters: Filters, issue: Partial<ZodIssue>) {
  expect(await refusal(create(filters))).toContainEqual(expect.objectContaining(issue));
  expect(db.insert).not.toHaveBeenCalled();

  expect(await refusal(update(filters))).toContainEqual(expect.objectContaining(issue));
  expect(db.update).not.toHaveBeenCalled();
}

describe('saved filters: nesting', () => {
  it(`stores groups ${SAVED_FILTER_LIMITS.depth} levels deep, on create and on update`, async () => {
    const filters = nestedFilter(SAVED_FILTER_LIMITS.depth);
    await expectStored(filters);

    await update(filters);
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ filters }));
  });

  it('refuses a group one level deeper, where the limit is reached', async () => {
    await expectRefused(nestedFilter(SAVED_FILTER_LIMITS.depth + 1), {
      path: ['filters', 'groups', 0, 'groups', 0, 'groups'],
      message: `条件のグループは${SAVED_FILTER_LIMITS.depth}段までです`,
    });
  });

  it('refuses a filter nested 5,000 levels deep with the zod issue, not a stack overflow', async () => {
    // The recursive schema (z.lazy) threw a RangeError at about 800 levels. This checks the zod
    // layer: through HTTP, superjson.deserialize copies the input recursively before zod runs
    // and runs out of stack on a filter this deep (from about 1,000 to 2,000 levels on Node 22),
    // which tRPC returns as its own BAD_REQUEST (Maximum call stack size exceeded), nothing
    // written
    await expectRefused(nestedFilter(5_000), {
      path: ['filters', 'groups', 0, 'groups', 0, 'groups'],
      message: `条件のグループは${SAVED_FILTER_LIMITS.depth}段までです`,
    });
  });

  it(`stores ${SAVED_FILTER_LIMITS.groups} groups in one group and refuses one more`, async () => {
    await expectStored(withGroups(SAVED_FILTER_LIMITS.groups));
    vi.clearAllMocks();
    await expectRefused(withGroups(SAVED_FILTER_LIMITS.groups + 1), {
      path: ['filters', 'groups'],
      code: 'too_big',
    });
  });
});

describe('saved filters: conditions', () => {
  it(`stores ${SAVED_FILTER_LIMITS.conditions} conditions over the whole filter`, async () => {
    await expectStored(spread(SAVED_FILTER_LIMITS.conditions));
  });

  it('refuses one condition more, counting every group', async () => {
    await expectRefused(spread(SAVED_FILTER_LIMITS.conditions + 1), {
      path: ['filters'],
      message: `条件は全体で${SAVED_FILTER_LIMITS.conditions}個までです`,
    });
  });

  it('refuses one group holding more conditions than the whole filter takes', async () => {
    await expectRefused(
      {
        logic: 'and',
        conditions: Array.from({ length: SAVED_FILTER_LIMITS.conditions + 1 }, () => condition()),
      },
      { path: ['filters', 'conditions'], code: 'too_big' }
    );
  });
});

describe('saved filters: fields, operators and values', () => {
  it(`stores a field name of ${SAVED_FILTER_LIMITS.fieldLength} characters and refuses one more`, async () => {
    await expectStored(oneCondition({ field: 'f'.repeat(SAVED_FILTER_LIMITS.fieldLength) }));
    vi.clearAllMocks();
    await expectRefused(oneCondition({ field: 'f'.repeat(SAVED_FILTER_LIMITS.fieldLength + 1) }), {
      path: ['filters', 'conditions', 0, 'field'],
      code: 'too_big',
    });
  });

  it('refuses an empty field name', async () => {
    await expectRefused(oneCondition({ field: '' }), {
      path: ['filters', 'conditions', 0, 'field'],
      code: 'too_small',
    });
  });

  it('refuses an operator it does not know', async () => {
    await expectRefused(oneCondition({ operator: 'matches_regex' }), {
      path: ['filters', 'conditions', 0, 'operator'],
      code: 'invalid_enum_value',
    });
  });

  it(`stores a text value of ${SAVED_FILTER_LIMITS.valueLength} characters and refuses one more`, async () => {
    await expectStored(oneCondition({ value: '株'.repeat(SAVED_FILTER_LIMITS.valueLength) }));
    vi.clearAllMocks();
    await expectRefused(oneCondition({ value: '株'.repeat(SAVED_FILTER_LIMITS.valueLength + 1) }), {
      path: ['filters', 'conditions', 0, 'value'],
    });
  });

  it(`stores a second value of ${SAVED_FILTER_LIMITS.valueLength} characters and refuses one more`, async () => {
    const between = (value2: string) => oneCondition({ operator: 'between', value: 'a', value2 });
    await expectStored(between('x'.repeat(SAVED_FILTER_LIMITS.valueLength)));
    vi.clearAllMocks();
    await expectRefused(between('x'.repeat(SAVED_FILTER_LIMITS.valueLength + 1)), {
      path: ['filters', 'conditions', 0, 'value2'],
    });
  });

  it(`stores a list of ${SAVED_FILTER_LIMITS.values} values and refuses one more`, async () => {
    await expectStored(oneCondition({ operator: 'in', value: list(SAVED_FILTER_LIMITS.values) }));
    vi.clearAllMocks();
    await expectRefused(
      oneCondition({ operator: 'in', value: list(SAVED_FILTER_LIMITS.values + 1) }),
      {
        path: ['filters', 'conditions', 0, 'value'],
      }
    );
  });

  it('refuses values that are neither text, a number, a boolean, a date nor a list of them', async () => {
    for (const value of [[['nested']], { company: '三田' }, Number.POSITIVE_INFINITY]) {
      vi.clearAllMocks();
      await expectRefused(oneCondition({ operator: 'in', value }), {
        path: ['filters', 'conditions', 0, 'value'],
      });
    }
  });

  it('still stores the shapes the operators use', async () => {
    await expectStored({
      logic: 'and',
      conditions: [
        { field: 'status', operator: 'equals', value: 'new' },
        { field: 'score', operator: 'between', value: 10, value2: 90 },
        { field: 'createdAt', operator: 'greater_than', value: new Date('2026-10-01T00:00:00Z') },
        { field: 'source', operator: 'in', value: ['website', 'embed'] },
        { field: 'phone', operator: 'is_empty' },
        { field: 'company', operator: 'not_equals', value: null },
        { field: 'email', operator: 'not_contains', value: true },
      ],
    });
  });
});
