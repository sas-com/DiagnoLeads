/**
 * Count limits of the tag assignment (#669): tags.setLeadTags and tags.bulkSetLeadTags give a
 * lead up to LEAD_TAGS_MAX tags, and bulkSetLeadTags takes up to a page of the lead list
 * (LEAD_LIST_PAGE_MAX), like the bulk actions of leads (#604). A count at its limit is written;
 * one over it is refused with BAD_REQUEST carrying the zod issues, before the ids are checked or
 * anything is deleted. Repeated ids count toward the limit and are written once, as before.
 */
import { LEAD_LIST_PAGE_MAX } from '@/lib/features/leads/types/schemas';
import { LEAD_TAGS_MAX } from '@/lib/features/tags/types/schemas';
import { assertInOrganization } from '@/lib/multi-tenant/helpers/scope';
import { appRouter } from '@/server/routers/_app';
import { TRPCError } from '@trpc/server';
import { ZodError, type ZodIssue } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth/permissions', () => ({
  defineAbilitiesFor: vi.fn(() => ({ can: vi.fn(() => true) })),
}));
// The organization of lead and tag ids is checked on a real database in
// test/unit/integration/tenant-scope.db.test.ts (#350)
vi.mock('@/lib/multi-tenant/helpers/scope', () => ({
  assertInOrganization: vi.fn().mockResolvedValue(undefined),
}));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '990e8400-e29b-41d4-a716-446655440000';

/** `count` distinct ids, told apart by `prefix` */
const idsOf = (count: number, prefix: string) =>
  Array.from(
    { length: count },
    (_, i) => `${prefix}000000-0000-4000-8000-${String(i).padStart(12, '0')}`
  );
const tagIdsOf = (count: number) => idsOf(count, '11');
const leadIdsOf = (count: number) => idsOf(count, '22');

/** A db whose deletes and inserts resolve to nothing; the transaction runs on it */
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
    },
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    insert: vi.fn(() => ({ values: db.values })),
    values: vi.fn().mockResolvedValue(undefined),
    // The tags of the lead read back after setLeadTags
    select: vi.fn(() => ({
      from: () => ({ innerJoin: () => ({ where: vi.fn().mockResolvedValue([]) }) }),
    })),
    transaction: vi.fn(),
  };
  db.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
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

const setLeadTags = (tagIds: string[]) =>
  appRouter.createCaller(ctx).tags.setLeadTags({ organizationId: ORG_ID, leadId: LEAD_ID, tagIds });

const bulkSetLeadTags = (leadIds: string[], tagIds: string[]) =>
  appRouter.createCaller(ctx).tags.bulkSetLeadTags({ organizationId: ORG_ID, leadIds, tagIds });

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

/** Nothing was checked, deleted or written */
function expectUntouched() {
  expect(assertInOrganization).not.toHaveBeenCalled();
  expect(db.transaction).not.toHaveBeenCalled();
  expect(db.delete).not.toHaveBeenCalled();
  expect(db.insert).not.toHaveBeenCalled();
}

describe('tags.setLeadTags: the tags of one call', () => {
  it(`gives a lead ${LEAD_TAGS_MAX} tags`, async () => {
    await setLeadTags(tagIdsOf(LEAD_TAGS_MAX));
    expect(db.values).toHaveBeenCalledTimes(1);
    expect(db.values.mock.calls[0]?.[0]).toHaveLength(LEAD_TAGS_MAX);
  });

  it('refuses one tag more and keeps the tags the lead has', async () => {
    const issues = await refusal(setLeadTags(tagIdsOf(LEAD_TAGS_MAX + 1)));
    expect(issues[0]).toMatchObject({
      path: ['tagIds'],
      code: 'too_big',
      message: `一度に付けられるタグは${LEAD_TAGS_MAX}個までです`,
    });
    expectUntouched();
  });

  it('still clears the tags when given none', async () => {
    await setLeadTags([]);
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('writes a repeated tag once, and counts repeats toward the limit', async () => {
    const [first, second] = tagIdsOf(2);
    await setLeadTags([first, second, first]);
    expect(db.values.mock.calls[0]?.[0]).toEqual([
      { leadId: LEAD_ID, tagId: first },
      { leadId: LEAD_ID, tagId: second },
    ]);

    vi.clearAllMocks();
    await refusal(setLeadTags(Array.from({ length: LEAD_TAGS_MAX + 1 }, () => first)));
    expectUntouched();
  });
});

describe('tags.bulkSetLeadTags: the leads and tags of one call', () => {
  it(`tags a full page of ${LEAD_LIST_PAGE_MAX} leads with ${LEAD_TAGS_MAX} tags in one insert`, async () => {
    const result = await bulkSetLeadTags(leadIdsOf(LEAD_LIST_PAGE_MAX), tagIdsOf(LEAD_TAGS_MAX));
    expect(result).toEqual({ success: true, updatedCount: LEAD_LIST_PAGE_MAX });
    expect(db.values).toHaveBeenCalledTimes(1);
    expect(db.values.mock.calls[0]?.[0]).toHaveLength(LEAD_LIST_PAGE_MAX * LEAD_TAGS_MAX);
  });

  it('refuses one lead more and changes no lead', async () => {
    const issues = await refusal(
      bulkSetLeadTags(leadIdsOf(LEAD_LIST_PAGE_MAX + 1), tagIdsOf(LEAD_TAGS_MAX))
    );
    expect(issues[0]).toMatchObject({
      path: ['leadIds'],
      code: 'too_big',
      message: `一度に選べるリードは${LEAD_LIST_PAGE_MAX}件までです`,
    });
    expectUntouched();
  });

  it('refuses one tag more and changes no lead', async () => {
    const issues = await refusal(
      bulkSetLeadTags(leadIdsOf(LEAD_LIST_PAGE_MAX), tagIdsOf(LEAD_TAGS_MAX + 1))
    );
    expect(issues[0]).toMatchObject({ path: ['tagIds'], code: 'too_big' });
    expectUntouched();
  });

  it('tags a repeated lead once, counting it as sent, as before', async () => {
    const [lead] = leadIdsOf(1);
    const [tag] = tagIdsOf(1);
    const result = await bulkSetLeadTags([lead, lead], [tag]);
    expect(result.updatedCount).toBe(2);
    expect(db.values.mock.calls[0]?.[0]).toEqual([{ leadId: lead, tagId: tag }]);
  });
});
