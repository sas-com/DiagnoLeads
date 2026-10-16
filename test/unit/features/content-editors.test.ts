/**
 * FAQ / blog editing is limited to CONTENT_EDITOR_EMAILS (#87) and to users granted on the
 * settings screen who are still members of the operating organization (#91).
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const OPERATING_ORG = '660e8400-e29b-41d4-a716-446655440000';
const OTHER_ORG = '660e8400-e29b-41d4-a716-446655440001';
const EDITOR_ID = '550e8400-e29b-41d4-a716-446655440001';
const OTHER_ID = '550e8400-e29b-41d4-a716-446655440002';

const env: { CONTENT_EDITOR_EMAILS?: string } = {};
const mocks = vi.hoisted(() => ({
  findAll: vi.fn(),
  create: vi.fn(),
  del: vi.fn(),
  orgId: { value: null as string | null },
}));

vi.mock('@/lib/env', () => ({ env }));
vi.mock('@/lib/features/diagnostics/organization', () => ({
  resolveDiagnosisOrganizationId: () => mocks.orgId.value,
}));
vi.mock('@/lib/cms', () => ({
  BlogRepository: class {
    findAll = mocks.findAll;
    findById = async (id: string) => ({ id });
    delete = mocks.del;
  },
  FAQRepository: class {
    create = mocks.create;
    findById = async (id: string) => ({ id });
    delete = mocks.del;
  },
}));

const { isContentEditor } = await import('@/lib/features/content/editors');
const { contentRouter } = await import('@/lib/features/content/api/router');

const params = (where: unknown) => new PgDialect().sqlToQuery(where as SQL).params as string[];

/** In-memory content_editors rows and memberships (`${userId}:${organizationId}`) */
const state = { grants: new Set<string>(), memberships: new Set<string>() };

const db = {
  select: () => ({
    from: () => ({
      where: (where: unknown) => ({
        limit: async () => {
          const [userId] = params(where);
          return state.grants.has(userId) ? [{ userId }] : [];
        },
      }),
    }),
  }),
  query: {
    organizationMembers: {
      findFirst: async ({ where }: { where: unknown }) => {
        const [userId, organizationId] = params(where);
        return state.memberships.has(`${userId}:${organizationId}`) ? { id: 'm' } : undefined;
      },
    },
  },
  // biome-ignore lint/suspicious/noExplicitAny: in-memory stand-in for the drizzle client
} as any;

const userWith = (email: string, id = OTHER_ID) => ({ id, email });

const callerAs = (email: string | null, id = OTHER_ID) =>
  contentRouter.createCaller(
    (email === null
      ? { db, session: null, user: null }
      : { db, session: {}, user: userWith(email, id) }) as never
  );

beforeEach(() => {
  vi.clearAllMocks();
  env.CONTENT_EDITOR_EMAILS = 'editor@example.com, Second@Example.com ';
  mocks.orgId.value = OPERATING_ORG;
  state.grants = new Set([EDITOR_ID]);
  state.memberships = new Set([`${EDITOR_ID}:${OPERATING_ORG}`]);
});

describe('isContentEditor', () => {
  it('matches listed emails, ignoring case and spaces', async () => {
    expect(await isContentEditor(db, userWith('editor@example.com'))).toBe(true);
    expect(await isContentEditor(db, userWith(' SECOND@example.com'))).toBe(true);
    expect(await isContentEditor(db, userWith('other@example.com'))).toBe(false);
    expect(await isContentEditor(db, null)).toBe(false);
  });

  it('lets nobody in through the list when the setting is missing or empty', async () => {
    env.CONTENT_EDITOR_EMAILS = undefined;
    expect(await isContentEditor(db, userWith('editor@example.com'))).toBe(false);
    env.CONTENT_EDITOR_EMAILS = ' , ';
    expect(await isContentEditor(db, userWith('editor@example.com'))).toBe(false);
  });

  it('accepts a user granted on the settings screen who is a member of the operating organization', async () => {
    expect(await isContentEditor(db, userWith('granted@example.com', EDITOR_ID))).toBe(true);
  });

  it('rejects a granted user who has left the operating organization', async () => {
    state.memberships = new Set([`${EDITOR_ID}:${OTHER_ORG}`]);
    expect(await isContentEditor(db, userWith('granted@example.com', EDITOR_ID))).toBe(false);
  });

  it('rejects a member of the operating organization who has not been granted', async () => {
    state.memberships.add(`${OTHER_ID}:${OPERATING_ORG}`);
    expect(await isContentEditor(db, userWith('member@example.com', OTHER_ID))).toBe(false);
  });

  it('uses only the email list when the operating organization is not configured', async () => {
    mocks.orgId.value = null;
    expect(await isContentEditor(db, userWith('granted@example.com', EDITOR_ID))).toBe(false);
    expect(await isContentEditor(db, userWith('editor@example.com'))).toBe(true);
  });
});

describe('content mutations', () => {
  it('forbid a signed-in user who is not an editor', async () => {
    await expect(callerAs('other@example.com').blog.delete({ id: 'p1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it('forbid everyone when no editor is configured', async () => {
    env.CONTENT_EDITOR_EMAILS = '';
    state.grants = new Set();
    await expect(callerAs('editor@example.com').faqs.delete({ id: 'f1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('reject anonymous callers', async () => {
    await expect(callerAs(null).faqs.delete({ id: 'f1' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('let a listed editor through', async () => {
    mocks.del.mockResolvedValue(true);
    await expect(callerAs('editor@example.com').blog.delete({ id: 'p1' })).resolves.toBeDefined();
    expect(mocks.del).toHaveBeenCalled();
  });

  it('let a granted editor through, and stop them once the grant is revoked', async () => {
    mocks.del.mockResolvedValue(true);
    await expect(
      callerAs('granted@example.com', EDITOR_ID).faqs.delete({ id: 'f1' })
    ).resolves.toBeDefined();

    state.grants.delete(EDITOR_ID);
    await expect(
      callerAs('granted@example.com', EDITOR_ID).faqs.delete({ id: 'f1' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.del).toHaveBeenCalledTimes(1);
  });
});

describe('blog.list drafts', () => {
  beforeEach(() => mocks.findAll.mockResolvedValue({ posts: [], total: 0, hasNextPage: false }));

  it('keeps the requested status for an editor', async () => {
    await callerAs('granted@example.com', EDITOR_ID).blog.list({ status: 'all' });
    expect(mocks.findAll).toHaveBeenCalledWith(expect.objectContaining({ status: 'all' }));
  });

  it.each([
    ['a non-editor', () => callerAs('other@example.com')],
    ['an anonymous caller', () => callerAs(null)],
  ])('returns only published posts to %s', async (_label, makeCaller) => {
    await makeCaller().blog.list({ status: 'all' });
    expect(mocks.findAll).toHaveBeenCalledWith(expect.objectContaining({ status: 'published' }));
  });
});

describe('content.canEdit', () => {
  it('is true only for an editor', async () => {
    await expect(callerAs('editor@example.com').canEdit()).resolves.toBe(true);
    await expect(callerAs('granted@example.com', EDITOR_ID).canEdit()).resolves.toBe(true);
    await expect(callerAs('other@example.com').canEdit()).resolves.toBe(false);
  });
});
