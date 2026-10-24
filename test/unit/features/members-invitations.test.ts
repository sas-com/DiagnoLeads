/**
 * Member invitations (lib/features/members/invitations.ts) without a database (#28): which rows
 * are read and written, how each state of an invitation is answered, and that the queries on an
 * organization's data (revoking the earlier invitation, the membership check on acceptance,
 * listing, revoking) are limited to that organization. Reading an invitation by its token goes by
 * the token hash, and accepting it updates the row by id. The database is a fake that answers
 * each awaited query with the next queued result and records the calls; it does not filter. The same functions on a real PostgreSQL (locks,
 * unique indexes, concurrent acceptance) are covered by
 * test/unit/integration/member-invitations.db.test.ts.
 */
import { createHash } from 'node:crypto';
import {
  type OrganizationInvitation,
  organizationInvitations,
  organizationMembers,
} from '@/lib/db/schema';
import {
  INVITATIONS_PER_ORGANIZATION,
  INVITATIONS_PER_USER,
  INVITATION_TTL_MS,
  acceptInvitation,
  createInvitation,
  getInvitationPreview,
  hashInvitationToken,
  isDuplicatePendingInvitation,
  isSignupInvited,
  listPendingInvitations,
  normalizeEmail,
  revokeInvitation,
} from '@/lib/features/members/invitations';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call = {
  op: 'select' | 'insert' | 'update';
  table?: unknown;
  where?: SQL;
  values?: Record<string, unknown>;
  set?: Record<string, unknown>;
  lock?: string;
  orderBy?: unknown[];
  limit?: number;
};

const dbState = { results: [] as unknown[][], calls: [] as Call[], transactions: 0 };

/** A query builder: every method returns itself; awaiting it yields the next queued result */
function query(op: Call['op']) {
  return (target?: unknown) => {
    const call: Call = { op, ...(op === 'select' ? {} : { table: target }) };
    dbState.calls.push(call);
    const promise = Promise.resolve().then(() => dbState.results.shift() ?? []);
    const builder = Object.assign(promise, {
      from: (table: unknown) => {
        call.table = table;
        return builder;
      },
      innerJoin: () => builder,
      leftJoin: () => builder,
      where: (where: SQL) => {
        call.where = where;
        return builder;
      },
      values: (values: Record<string, unknown>) => {
        call.values = values;
        return builder;
      },
      set: (set: Record<string, unknown>) => {
        call.set = set;
        return builder;
      },
      for: (lock: string) => {
        call.lock = lock;
        return builder;
      },
      orderBy: (...order: unknown[]) => {
        call.orderBy = order;
        return builder;
      },
      limit: (limit: number) => {
        call.limit = limit;
        return builder;
      },
      returning: () => builder,
    });
    return builder;
  };
}

const fakeDb = {
  select: query('select'),
  insert: query('insert'),
  update: query('update'),
  transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    dbState.transactions += 1;
    return fn(fakeDb);
  },
};
const db = fakeDb as unknown as Parameters<typeof createInvitation>[0];

const dialect = new PgDialect();
/** The SQL text and parameters of a recorded where clause */
const whereOf = (call: Call | undefined) => {
  if (!call?.where) throw new Error('No where clause');
  return dialect.sqlToQuery(call.where);
};

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const INVITER_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440001';
const INVITATION_ID = '770e8400-e29b-41d4-a716-446655440000';
const TOKEN = 'k'.repeat(43);
const NOW = new Date('2026-10-24T01:00:00Z');

function invitation(overrides: Partial<OrganizationInvitation> = {}): OrganizationInvitation {
  return {
    id: INVITATION_ID,
    organizationId: ORG_ID,
    email: 'new@example.com',
    role: 'member',
    tokenHash: hashInvitationToken(TOKEN),
    status: 'pending',
    invitedBy: INVITER_ID,
    acceptedBy: null,
    expiresAt: new Date(NOW.getTime() + INVITATION_TTL_MS),
    acceptedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  dbState.results = [];
  dbState.calls = [];
  dbState.transactions = 0;
});

describe('limits and helpers', () => {
  it('lets an invitation be accepted for 48 hours', () => {
    expect(INVITATION_TTL_MS).toBe(48 * 60 * 60 * 1000);
  });

  it('allows 20 invitation emails an hour per inviter and per organization', () => {
    expect(INVITATIONS_PER_USER).toMatchObject({ limit: 20, windowMs: 60 * 60 * 1000 });
    expect(INVITATIONS_PER_ORGANIZATION).toMatchObject({ limit: 20, windowMs: 60 * 60 * 1000 });
    expect(INVITATIONS_PER_USER.name).not.toBe(INVITATIONS_PER_ORGANIZATION.name);
  });

  it('hashes a token with SHA-256, so only the hash is stored', () => {
    expect(hashInvitationToken(TOKEN)).toBe(createHash('sha256').update(TOKEN).digest('hex'));
    expect(hashInvitationToken(TOKEN)).not.toBe(hashInvitationToken(`${TOKEN}x`));
  });

  it('compares addresses trimmed and in lower case', () => {
    expect(normalizeEmail('  Taro.Yamada@Example.COM ')).toBe('taro.yamada@example.com');
  });

  it('recognizes the unique violation of a concurrent invitation, also when wrapped', () => {
    expect(isDuplicatePendingInvitation({ code: '23505' })).toBe(true);
    expect(
      isDuplicatePendingInvitation(new Error('insert failed', { cause: { code: '23505' } }))
    ).toBe(true);
    expect(isDuplicatePendingInvitation({ code: '23503' })).toBe(false);
    expect(isDuplicatePendingInvitation(new Error('x', { cause: { code: '40001' } }))).toBe(false);
    expect(isDuplicatePendingInvitation(null)).toBe(false);
    expect(isDuplicatePendingInvitation(undefined)).toBe(false);
    expect(isDuplicatePendingInvitation('23505')).toBe(false);
  });
});

describe('createInvitation', () => {
  it('revokes the pending invitation to the address, then stores the new one with a hashed token', async () => {
    const stored = invitation();
    dbState.results = [[], [stored]];

    const result = await createInvitation(
      db,
      { organizationId: ORG_ID, email: ' New@Example.com ', role: 'admin', invitedBy: INVITER_ID },
      NOW
    );

    expect(dbState.transactions).toBe(1);
    const [revoke, insert] = dbState.calls;
    expect(revoke).toMatchObject({
      op: 'update',
      table: organizationInvitations,
      set: { status: 'revoked', updatedAt: NOW },
    });
    const where = whereOf(revoke);
    expect(where.sql).toContain('"organization_invitations"."organization_id" = $1');
    expect(where.sql).toContain('"organization_invitations"."email" = $2');
    expect(where.sql).toContain('"organization_invitations"."status" = $3');
    expect(where.params).toEqual([ORG_ID, 'new@example.com', 'pending']);

    expect(insert).toMatchObject({ op: 'insert', table: organizationInvitations });
    expect(insert.values).toEqual({
      organizationId: ORG_ID,
      email: 'new@example.com',
      role: 'admin',
      tokenHash: hashInvitationToken(result.token),
      invitedBy: INVITER_ID,
      expiresAt: new Date(NOW.getTime() + INVITATION_TTL_MS),
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(result.invitation).toBe(stored);
  });

  it('makes a new random URL-safe token of 32 bytes each time', async () => {
    dbState.results = [[], [invitation()], [], [invitation()]];
    const input = {
      organizationId: ORG_ID,
      email: 'a@example.com',
      role: 'member' as const,
      invitedBy: INVITER_ID,
    };

    const first = await createInvitation(db, input, NOW);
    const second = await createInvitation(db, input, NOW);

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
  });
});

describe('getInvitationPreview', () => {
  it('returns null for an unknown token', async () => {
    dbState.results = [[]];

    expect(await getInvitationPreview(db, TOKEN, NOW)).toBeNull();
    const where = whereOf(dbState.calls[0]);
    expect(where.sql).toContain('"organization_invitations"."token_hash" = $1');
    expect(where.params).toEqual([hashInvitationToken(TOKEN)]);
    expect(dbState.calls[0].limit).toBe(1);
  });

  it('shows the organization, inviter, address, role and expiry of a usable invitation', async () => {
    const row = invitation({ role: 'admin' });
    dbState.results = [[{ invitation: row, organizationName: '営業部', inviterName: '山田' }]];

    expect(await getInvitationPreview(db, TOKEN, NOW)).toEqual({
      state: 'valid',
      organizationName: '営業部',
      inviterName: '山田',
      email: 'new@example.com',
      role: 'admin',
      expiresAt: row.expiresAt,
    });
  });

  it('gives no inviter name when the inviter has none or was deleted', async () => {
    dbState.results = [
      [{ invitation: invitation(), organizationName: '営業部', inviterName: '' }],
      [{ invitation: invitation(), organizationName: '営業部', inviterName: null }],
    ];

    expect(await getInvitationPreview(db, TOKEN, NOW)).toMatchObject({ inviterName: null });
    expect(await getInvitationPreview(db, TOKEN, NOW)).toMatchObject({ inviterName: null });
  });

  it.each([
    ['accepted', invitation({ status: 'accepted', acceptedBy: USER_ID })],
    ['revoked', invitation({ status: 'revoked' })],
    ['expired', invitation({ expiresAt: NOW })],
    ['expired', invitation({ expiresAt: new Date(NOW.getTime() - 1) })],
  ] as const)('tells only the state of an %s invitation', async (state, row) => {
    dbState.results = [[{ invitation: row, organizationName: '営業部', inviterName: '山田' }]];

    expect(await getInvitationPreview(db, TOKEN, NOW)).toEqual({ state });
  });

  it('counts the time from now by default', async () => {
    dbState.results = [
      [
        {
          invitation: invitation({ expiresAt: new Date(Date.now() - 1000) }),
          organizationName: '営業部',
          inviterName: null,
        },
      ],
    ];

    expect(await getInvitationPreview(db, TOKEN)).toEqual({ state: 'expired' });
  });
});

describe('isSignupInvited', () => {
  it.each([
    ['no token', undefined],
    ['a number', 12345],
    ['a short token', 'k'.repeat(31)],
    ['a long token', 'k'.repeat(129)],
  ])('refuses %s without reading the database', async (_label, token) => {
    expect(await isSignupInvited(db, token, 'new@example.com', NOW)).toBe(false);
    expect(dbState.calls).toHaveLength(0);
  });

  it('accepts the invited address with the token of a pending invitation', async () => {
    dbState.results = [[invitation()]];

    expect(await isSignupInvited(db, TOKEN, ' NEW@example.com', NOW)).toBe(true);
    expect(whereOf(dbState.calls[0]).params).toEqual([hashInvitationToken(TOKEN)]);
  });

  it('accepts tokens of 32 to 128 characters and looks each one up by its hash', async () => {
    dbState.results = [[invitation()], [invitation()]];

    expect(await isSignupInvited(db, 'a'.repeat(32), 'new@example.com', NOW)).toBe(true);
    expect(await isSignupInvited(db, 'a'.repeat(128), 'new@example.com', NOW)).toBe(true);
    expect(dbState.calls.map((call) => whereOf(call).params)).toEqual([
      [hashInvitationToken('a'.repeat(32))],
      [hashInvitationToken('a'.repeat(128))],
    ]);
  });

  it('refuses another address, an unknown token and an invitation that cannot be used', async () => {
    dbState.results = [
      [invitation()],
      [],
      [invitation({ status: 'accepted' })],
      [invitation({ status: 'revoked' })],
      [invitation({ expiresAt: NOW })],
    ];

    expect(await isSignupInvited(db, TOKEN, 'other@example.com', NOW)).toBe(false);
    expect(await isSignupInvited(db, TOKEN, 'new@example.com', NOW)).toBe(false);
    expect(await isSignupInvited(db, TOKEN, 'new@example.com', NOW)).toBe(false);
    expect(await isSignupInvited(db, TOKEN, 'new@example.com', NOW)).toBe(false);
    expect(await isSignupInvited(db, TOKEN, 'new@example.com', NOW)).toBe(false);
  });
});

describe('acceptInvitation', () => {
  const user = { id: USER_ID, email: 'New@Example.com' };

  afterEach(() => vi.unstubAllEnvs());

  it('adds the user with the invited role and marks the invitation accepted', async () => {
    dbState.results = [[invitation({ role: 'admin' })], [], [], []];

    expect(await acceptInvitation(db, TOKEN, user, NOW)).toEqual({
      ok: true,
      organizationId: ORG_ID,
    });

    expect(dbState.transactions).toBe(1);
    const [read, membership, insert, update] = dbState.calls;
    // Locked, so a concurrent acceptance waits for this one
    expect(read).toMatchObject({
      op: 'select',
      table: organizationInvitations,
      lock: 'no key update',
    });
    expect(whereOf(read).params).toEqual([hashInvitationToken(TOKEN)]);

    expect(membership).toMatchObject({ op: 'select', table: organizationMembers, limit: 1 });
    expect(whereOf(membership).sql).toContain('"organization_members"."organization_id" = $1');
    expect(whereOf(membership).params).toEqual([ORG_ID, USER_ID]);

    expect(insert).toMatchObject({
      op: 'insert',
      table: organizationMembers,
      values: { organizationId: ORG_ID, userId: USER_ID, role: 'admin' },
    });
    expect(update).toMatchObject({
      op: 'update',
      table: organizationInvitations,
      set: { status: 'accepted', acceptedBy: USER_ID, acceptedAt: NOW, updatedAt: NOW },
    });
    expect(whereOf(update).params).toEqual([INVITATION_ID]);
  });

  it('keeps the role of someone who is already a member', async () => {
    dbState.results = [[invitation({ role: 'admin' })], [{ id: 'membership-1' }], []];

    expect(await acceptInvitation(db, TOKEN, user, NOW)).toEqual({
      ok: true,
      organizationId: ORG_ID,
    });
    expect(dbState.calls.map((c) => c.op)).toEqual(['select', 'select', 'update']);
  });

  it('succeeds again without changes for the user who accepted it', async () => {
    dbState.results = [[invitation({ status: 'accepted', acceptedBy: USER_ID })]];

    expect(await acceptInvitation(db, TOKEN, user, NOW)).toEqual({
      ok: true,
      organizationId: ORG_ID,
    });
    expect(dbState.calls).toHaveLength(1);
  });

  it.each([
    ['not_found', undefined],
    ['already_used', invitation({ status: 'accepted', acceptedBy: INVITER_ID })],
    ['revoked', invitation({ status: 'revoked' })],
    ['expired', invitation({ expiresAt: NOW })],
    ['email_mismatch', invitation({ email: 'someone@example.com' })],
  ] as const)('refuses with %s and changes nothing', async (reason, row) => {
    dbState.results = [row ? [row] : []];

    expect(await acceptInvitation(db, TOKEN, user, NOW)).toEqual({ ok: false, reason });
    expect(dbState.calls).toHaveLength(1);
  });

  it('in test mode, refuses an invitation made earlier to an outside address', async () => {
    vi.stubEnv('APP_TEST_MODE', 'true');
    vi.stubEnv('APP_TEST_MODE_EMAIL_DOMAINS', 'sas-com.com');
    dbState.results = [[invitation()]];

    expect(await acceptInvitation(db, TOKEN, user, NOW)).toEqual({
      ok: false,
      reason: 'email_not_allowed',
    });
    expect(dbState.calls).toHaveLength(1);
  });

  it('in test mode, accepts a company address', async () => {
    vi.stubEnv('APP_TEST_MODE', 'true');
    vi.stubEnv('APP_TEST_MODE_EMAIL_DOMAINS', 'sas-com.com');
    dbState.results = [[invitation({ email: 'taro@sas-com.com' })], [], [], []];

    expect(
      await acceptInvitation(db, TOKEN, { id: USER_ID, email: 'taro@sas-com.com' }, NOW)
    ).toEqual({ ok: true, organizationId: ORG_ID });
  });
});

describe('listPendingInvitations', () => {
  it('lists the pending invitations of the organization, newest first, flagging expired ones', async () => {
    const fresh = {
      id: 'a',
      email: 'a@example.com',
      role: 'member',
      expiresAt: new Date(NOW.getTime() + 1000),
      createdAt: NOW,
    };
    const old = {
      id: 'b',
      email: 'b@example.com',
      role: 'admin',
      expiresAt: NOW,
      createdAt: new Date(NOW.getTime() - INVITATION_TTL_MS),
    };
    dbState.results = [[fresh, old]];

    expect(await listPendingInvitations(db, ORG_ID, NOW)).toEqual([
      { ...fresh, expired: false },
      { ...old, expired: true },
    ]);

    const [call] = dbState.calls;
    expect(call.table).toBe(organizationInvitations);
    const where = whereOf(call);
    expect(where.sql).toContain('"organization_invitations"."organization_id" = $1');
    expect(where.params).toEqual([ORG_ID, 'pending']);
    expect(call.orderBy).toHaveLength(1);
    expect(dialect.sqlToQuery(call.orderBy?.[0] as SQL).sql).toBe(
      '"organization_invitations"."created_at" desc'
    );
  });

  it('returns an empty list when there are none', async () => {
    dbState.results = [[]];
    expect(await listPendingInvitations(db, ORG_ID)).toEqual([]);
  });
});

describe('revokeInvitation', () => {
  it('revokes a pending invitation of the organization only', async () => {
    dbState.results = [[{ id: INVITATION_ID }]];

    expect(await revokeInvitation(db, ORG_ID, INVITATION_ID, NOW)).toBe(true);

    const [call] = dbState.calls;
    expect(call).toMatchObject({
      op: 'update',
      table: organizationInvitations,
      set: { status: 'revoked', updatedAt: NOW },
    });
    const where = whereOf(call);
    expect(where.sql).toContain('"organization_invitations"."id" = $1');
    expect(where.sql).toContain('"organization_invitations"."organization_id" = $2');
    expect(where.params).toEqual([INVITATION_ID, ORG_ID, 'pending']);
  });

  it('returns false when no pending invitation matched', async () => {
    dbState.results = [[]];
    expect(await revokeInvitation(db, ORG_ID, INVITATION_ID)).toBe(false);
  });
});
