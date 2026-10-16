/**
 * contentEditors router: only owners / admins of the operating organization manage editors,
 * candidates must be members of it, grants are idempotent and audit-logged (#91).
 * Uses the real CASL abilities; the database is an in-memory stand-in.
 */
import { auditLogs, contentEditors } from '@/lib/db/schema';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const OPERATING_ORG = '660e8400-e29b-41d4-a716-446655440000';
const OTHER_ORG = '660e8400-e29b-41d4-a716-446655440001';
const CALLER = '550e8400-e29b-41d4-a716-446655440000';
const MEMBER = '550e8400-e29b-41d4-a716-446655440001';
const OUTSIDER = '550e8400-e29b-41d4-a716-446655440002';

const { orgState } = vi.hoisted(() => ({ orgState: { id: null as string | null } }));
vi.mock('@/lib/features/diagnostics/organization', () => ({
  resolveDiagnosisOrganizationId: () => orgState.id,
}));
// The router must use ctx.db; the global client is left empty so a stray use fails
vi.mock('@/lib/db/client', () => ({ db: {} }));

const { appRouter } = await import('@/server/routers/_app');

type Row = Record<string, unknown>;
const state = {
  /** `${userId}:${organizationId}` -> role */
  memberships: new Map<string, string>(),
  grants: new Set<string>(),
  audits: [] as Row[],
  selectRows: [] as Row[],
};

const params = (where: unknown) => new PgDialect().sqlToQuery(where as SQL).params as string[];

function makeDb() {
  const selectChain: Record<string, unknown> = {};
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy']) {
    selectChain[method] = () => selectChain;
  }
  // biome-ignore lint/suspicious/noThenProperty: awaited like a drizzle query
  selectChain.then = (resolve: (rows: Row[]) => unknown) => resolve(state.selectRows);

  const tx = {
    insert: (table: unknown) => ({
      values: (values: Row) => {
        if (table === auditLogs) {
          state.audits.push(values);
          return Promise.resolve();
        }
        expect(table).toBe(contentEditors);
        return {
          onConflictDoNothing: () => ({
            returning: async () => {
              const userId = values.userId as string;
              if (state.grants.has(userId)) return [];
              state.grants.add(userId);
              return [{ userId }];
            },
          }),
        };
      },
    }),
    delete: () => ({
      where: (where: unknown) => ({
        returning: async () => {
          const [userId] = params(where);
          return state.grants.delete(userId) ? [{ userId }] : [];
        },
      }),
    }),
  };

  return {
    ...tx,
    select: () => selectChain,
    transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
    query: {
      organizationMembers: {
        findFirst: async ({ where }: { where: unknown }) => {
          const [userId, organizationId] = params(where);
          const role = state.memberships.get(`${userId}:${organizationId}`);
          return role
            ? {
                id: `m-${userId}`,
                userId,
                organizationId,
                role,
                createdAt: new Date(),
                updatedAt: new Date(),
              }
            : undefined;
        },
      },
    },
  };
}

function caller() {
  const user = {
    id: CALLER,
    email: 'caller@example.com',
    name: 'Caller',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const ctx = { db: makeDb(), session: { session: { id: 's', userId: CALLER }, user }, user };
  // biome-ignore lint/suspicious/noExplicitAny: test context
  return appRouter.createCaller(ctx as any).contentEditors;
}

const setRole = (userId: string, organizationId: string, role: string) =>
  state.memberships.set(`${userId}:${organizationId}`, role);

beforeEach(() => {
  orgState.id = OPERATING_ORG;
  state.memberships = new Map();
  state.grants = new Set();
  state.audits = [];
  state.selectRows = [];
  setRole(MEMBER, OPERATING_ORG, 'member');
});

describe('who may manage editors', () => {
  it.each(['owner', 'admin'])('an %s of the operating organization may', async (role) => {
    setRole(CALLER, OPERATING_ORG, role);
    await expect(caller().canManage()).resolves.toEqual({ configured: true, canManage: true });
    await expect(caller().list()).resolves.toEqual([]);
  });

  const forbidden: [string, () => void][] = [
    ['a member of the operating organization', () => setRole(CALLER, OPERATING_ORG, 'member')],
    ['a group owner in the operating organization', () => setRole(CALLER, OPERATING_ORG, 'group_owner')],
    ['a group admin in the operating organization', () => setRole(CALLER, OPERATING_ORG, 'group_admin')],
    ['a parent viewer in the operating organization', () => setRole(CALLER, OPERATING_ORG, 'parent_viewer')],
    ['an owner of another organization', () => setRole(CALLER, OTHER_ORG, 'owner')],
    ['an admin of another organization', () => setRole(CALLER, OTHER_ORG, 'admin')],
    ['a group owner of another organization', () => setRole(CALLER, OTHER_ORG, 'group_owner')],
    ['a user with no organization', () => {}],
  ];

  it.each(forbidden)('%s may not', async (_label, arrange) => {
    arrange();
    await expect(caller().canManage()).resolves.toEqual({ configured: true, canManage: false });
    for (const call of [
      () => caller().list(),
      () => caller().candidates(),
      () => caller().grant({ userId: MEMBER }),
      () => caller().revoke({ userId: MEMBER }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(state.grants.size).toBe(0);
    expect(state.audits).toHaveLength(0);
  });

  it('nobody may when the operating organization is not configured', async () => {
    orgState.id = null;
    setRole(CALLER, OPERATING_ORG, 'owner');
    await expect(caller().canManage()).resolves.toEqual({ configured: false, canManage: false });
    await expect(caller().grant({ userId: MEMBER })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(state.grants.size).toBe(0);
  });
});

describe('grant', () => {
  beforeEach(() => setRole(CALLER, OPERATING_ORG, 'admin'));

  it('grants a member of the operating organization and writes an audit log', async () => {
    await expect(caller().grant({ userId: MEMBER })).resolves.toEqual({ created: true });
    expect([...state.grants]).toEqual([MEMBER]);
    expect(state.audits).toEqual([
      expect.objectContaining({
        organizationId: OPERATING_ORG,
        userId: CALLER,
        action: 'create',
        resource: 'content_editor',
        resourceId: MEMBER,
      }),
    ]);
  });

  it('is idempotent: granting again changes nothing and logs nothing', async () => {
    await caller().grant({ userId: MEMBER });
    await expect(caller().grant({ userId: MEMBER })).resolves.toEqual({ created: false });
    expect([...state.grants]).toEqual([MEMBER]);
    expect(state.audits).toHaveLength(1);
  });

  it('refuses a user who is not a member of the operating organization', async () => {
    setRole(OUTSIDER, OTHER_ORG, 'owner');
    await expect(caller().grant({ userId: OUTSIDER })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(state.grants.size).toBe(0);
    expect(state.audits).toHaveLength(0);
  });
});

describe('revoke', () => {
  beforeEach(() => setRole(CALLER, OPERATING_ORG, 'owner'));

  it('removes the grant and writes an audit log', async () => {
    state.grants.add(MEMBER);
    await expect(caller().revoke({ userId: MEMBER })).resolves.toEqual({ revoked: true });
    expect(state.grants.size).toBe(0);
    expect(state.audits).toEqual([
      expect.objectContaining({
        organizationId: OPERATING_ORG,
        userId: CALLER,
        action: 'delete',
        resource: 'content_editor',
        resourceId: MEMBER,
      }),
    ]);
  });

  it('does nothing for a user who is not an editor', async () => {
    await expect(caller().revoke({ userId: MEMBER })).resolves.toEqual({ revoked: false });
    expect(state.audits).toHaveLength(0);
  });
});

describe('list', () => {
  it('marks editors who left the operating organization as inactive', async () => {
    setRole(CALLER, OPERATING_ORG, 'owner');
    const grantedAt = new Date('2026-10-16T00:00:00Z');
    state.selectRows = [
      { userId: MEMBER, name: 'A', email: 'a@example.com', grantedAt, memberId: 'm1' },
      { userId: OUTSIDER, name: null, email: 'b@example.com', grantedAt, memberId: null },
    ];
    await expect(caller().list()).resolves.toEqual([
      { userId: MEMBER, name: 'A', email: 'a@example.com', grantedAt, active: true },
      { userId: OUTSIDER, name: null, email: 'b@example.com', grantedAt, active: false },
    ]);
  });
});
