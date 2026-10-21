import type { Organization, OrganizationMember, User } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Saved filters and custom reports: a list request must never return other members'
// private items, whatever visibility flags it sends (#262)

vi.mock('@/lib/db/rls', () => ({
  setCurrentUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/auth/permissions', () => ({
  defineAbilitiesFor: vi.fn(() => ({ can: vi.fn(() => true) })),
}));

const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const TEST_ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

const mockUser: User = {
  id: TEST_USER_ID,
  email: 'test@example.com',
  name: 'Test User',
  emailVerified: true,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockOrganization: Organization = {
  id: TEST_ORG_ID,
  name: 'Test Organization',
  slug: 'test-org',
  settings: {},
  parentOrganizationId: null,
  organizationType: 'independent',
  hierarchyPath: TEST_ORG_ID,
  hierarchyLevel: 0,
  groupId: null,
  dataSharingPolicy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockMembership: OrganizationMember & { organization: Organization } = {
  id: '770e8400-e29b-41d4-a716-446655440000',
  organizationId: TEST_ORG_ID,
  userId: TEST_USER_ID,
  role: 'member',
  createdAt: new Date(),
  updatedAt: new Date(),
  organization: mockOrganization,
};

const dialect = new PgDialect();

function whereSql(findMany: ReturnType<typeof vi.fn>): string {
  const args = findMany.mock.calls[0]?.[0] as { where: SQL } | undefined;
  if (!args) throw new Error('findMany was not called');
  return dialect.sqlToQuery(args.where).sql;
}

describe.each([
  { name: 'filters.list', table: 'savedFilters' as const },
  { name: 'customReports.list', table: 'customReports' as const },
])('$name visibility', ({ table }) => {
  let findMany: ReturnType<typeof vi.fn>;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    findMany = vi.fn().mockResolvedValue([]);
    const db = {
      query: {
        organizationMembers: { findFirst: vi.fn().mockResolvedValue(mockMembership) },
        [table]: { findMany },
      },
    };
    caller = appRouter.createCaller({
      db,
      session: { id: 'session-123' },
      user: mockUser,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  });

  function list(input: { includePublic?: boolean; includePrivate?: boolean }) {
    const params = { organizationId: TEST_ORG_ID, ...input };
    return table === 'savedFilters'
      ? caller.filters.list(params)
      : caller.customReports.list(params);
  }

  it('returns nothing without querying when neither public nor private is selected', async () => {
    const result = await list({ includePublic: false, includePrivate: false });

    expect(result).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('limits private items to the current user by default', async () => {
    await list({});

    const sql = whereSql(findMany);
    expect(sql).toContain('"organization_id" = $1');
    expect(sql).toMatch(/"is_public" = \$\d+ or .*"user_id" = \$\d+/);
  });

  it('returns only public items when private is not selected', async () => {
    await list({ includePublic: true, includePrivate: false });

    const sql = whereSql(findMany);
    expect(sql).toContain('"is_public"');
    expect(sql).not.toContain('"user_id"');
  });

  it("returns only the current user's items when public is not selected", async () => {
    await list({ includePublic: false, includePrivate: true });

    const sql = whereSql(findMany);
    expect(sql).toContain('"user_id"');
    expect(sql).not.toContain('"is_public"');
  });
});
