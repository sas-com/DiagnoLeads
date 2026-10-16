/**
 * agencyLinks router: who may list / create / disable, and that every query is scoped to the
 * caller's organization (Refs #147). Uses the real CASL abilities.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const { dbState } = vi.hoisted(() => ({
  dbState: {
    listRows: [] as unknown[],
    updateRows: [] as unknown[],
    whereArgs: [] as unknown[],
    insertValues: [] as unknown[],
    setValues: [] as unknown[],
  },
}));

const linksDb = {
  select: () => ({
    from: () => ({
      leftJoin: () => ({
        where: (arg: unknown) => {
          dbState.whereArgs.push(arg);
          return { groupBy: () => ({ orderBy: async () => dbState.listRows }) };
        },
      }),
    }),
  }),
  insert: () => ({
    values: (values: unknown) => {
      dbState.insertValues.push(values);
      return { returning: async () => [{ id: 'new-id', code: 'abcdefghjkmn' }] };
    },
  }),
  update: () => ({
    set: (values: unknown) => {
      dbState.setValues.push(values);
      return {
        where: (arg: unknown) => {
          dbState.whereArgs.push(arg);
          return { returning: async () => dbState.updateRows };
        },
      };
    },
  }),
};

// The router must use ctx.db; the global client is left empty so a stray use fails
vi.mock('@/lib/db/client', () => ({ db: {} }));

const { appRouter } = await import('@/server/routers/_app');

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LINK_ID = '880e8400-e29b-41d4-a716-446655440000';

function callerAs(role: string | null) {
  const user = {
    id: USER_ID,
    email: 'test@example.com',
    name: 'Test',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const membership =
    role === null
      ? undefined
      : {
          id: '770e8400-e29b-41d4-a716-446655440000',
          organizationId: ORG_ID,
          userId: USER_ID,
          role,
          createdAt: new Date(),
          updatedAt: new Date(),
          organization: { id: ORG_ID, name: 'Org', slug: 'org', settings: {} },
        };
  const ctx = {
    db: {
      ...linksDb,
      query: { organizationMembers: { findFirst: vi.fn().mockResolvedValue(membership) } },
    },
    session: { session: { id: 's', userId: USER_ID }, user },
    user,
  };
  // biome-ignore lint/suspicious/noExplicitAny: test context
  return appRouter.createCaller(ctx as any);
}

const toQuery = (sql: unknown) => new PgDialect().sqlToQuery(sql as SQL);

beforeEach(() => {
  dbState.listRows = [];
  dbState.updateRows = [];
  dbState.whereArgs = [];
  dbState.insertValues = [];
  dbState.setValues = [];
});

describe('agencyLinks.list', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['member', false],
  ])('%s can list; canManage=%s; scoped to the organization', async (role, canManage) => {
    dbState.listRows = [{ id: LINK_ID, kind: 'telemarketing_agency', leadCount: 2 }];

    const result = await callerAs(role).agencyLinks.list({ organizationId: ORG_ID });

    expect(result.links).toHaveLength(1);
    expect(result.canManage).toBe(canManage);
    const where = toQuery(dbState.whereArgs[0]);
    expect(where.sql).toContain('"organization_id"');
    expect(where.params).toEqual([ORG_ID]);
  });

  it.each(['parent_viewer', null])('forbids %s', async (role) => {
    await expect(
      callerAs(role).agencyLinks.list({ organizationId: ORG_ID })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(dbState.whereArgs).toHaveLength(0);
  });
});

describe('agencyLinks.create', () => {
  it('stores the link in the caller organization with a generated code', async () => {
    const result = await callerAs('admin').agencyLinks.create({
      organizationId: ORG_ID,
      agencyName: ' 代行A ',
      kind: 'telemarketing_agency',
      campaign: '',
    });

    expect(result).toEqual({ id: 'new-id', code: 'abcdefghjkmn' });
    expect(dbState.insertValues[0]).toMatchObject({
      organizationId: ORG_ID,
      agencyName: '代行A',
      kind: 'telemarketing_agency',
      campaign: null,
      createdBy: USER_ID,
    });
    expect((dbState.insertValues[0] as { code: string }).code).toHaveLength(12);
  });

  it.each(['member', 'parent_viewer'])('forbids %s', async (role) => {
    await expect(
      callerAs(role).agencyLinks.create({
        organizationId: ORG_ID,
        agencyName: 'A',
        kind: 'referral_agency',
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(dbState.insertValues).toHaveLength(0);
  });
});

describe('agencyLinks.setActive', () => {
  it('disables a link of the caller organization', async () => {
    dbState.updateRows = [{ id: LINK_ID, disabledAt: new Date() }];

    await callerAs('owner').agencyLinks.setActive({
      organizationId: ORG_ID,
      id: LINK_ID,
      active: false,
    });

    expect((dbState.setValues[0] as { disabledAt: unknown }).disabledAt).toBeInstanceOf(Date);
    const where = toQuery(dbState.whereArgs[0]);
    expect(where.params).toEqual([LINK_ID, ORG_ID]);
  });

  it('re-enables a link by clearing disabledAt', async () => {
    dbState.updateRows = [{ id: LINK_ID, disabledAt: null }];
    await callerAs('owner').agencyLinks.setActive({
      organizationId: ORG_ID,
      id: LINK_ID,
      active: true,
    });
    expect(dbState.setValues[0]).toEqual({ disabledAt: null });
  });

  it('answers NOT_FOUND for a link of another organization', async () => {
    await expect(
      callerAs('owner').agencyLinks.setActive({ organizationId: ORG_ID, id: LINK_ID, active: false })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('forbids a member', async () => {
    await expect(
      callerAs('member').agencyLinks.setActive({ organizationId: ORG_ID, id: LINK_ID, active: false })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(dbState.setValues).toHaveLength(0);
  });
});
