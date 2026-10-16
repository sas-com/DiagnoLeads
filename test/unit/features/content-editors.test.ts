/**
 * FAQ / blog editing is limited to CONTENT_EDITOR_EMAILS (#87).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env: { CONTENT_EDITOR_EMAILS?: string } = {};
const mocks = vi.hoisted(() => ({ findAll: vi.fn(), create: vi.fn(), del: vi.fn() }));

vi.mock('@/lib/env', () => ({ env }));
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

const callerAs = (email: string | null) =>
  contentRouter.createCaller(
    // biome-ignore lint/suspicious/noExplicitAny: tRPC test context
    (email === null ? { session: null, user: null } : { session: {}, user: { id: 'u1', email } }) as any
  );

beforeEach(() => {
  vi.clearAllMocks();
  env.CONTENT_EDITOR_EMAILS = 'editor@example.com, Second@Example.com ';
});

describe('isContentEditor', () => {
  it('matches listed emails, ignoring case and spaces', () => {
    expect(isContentEditor('editor@example.com')).toBe(true);
    expect(isContentEditor(' SECOND@example.com')).toBe(true);
    expect(isContentEditor('other@example.com')).toBe(false);
    expect(isContentEditor(null)).toBe(false);
  });

  it('lets nobody edit when the setting is missing or empty', () => {
    env.CONTENT_EDITOR_EMAILS = undefined;
    expect(isContentEditor('editor@example.com')).toBe(false);
    env.CONTENT_EDITOR_EMAILS = ' , ';
    expect(isContentEditor('editor@example.com')).toBe(false);
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
});

describe('blog.list drafts', () => {
  it('keeps the requested status for an editor', async () => {
    mocks.findAll.mockResolvedValue({ posts: [], total: 0, hasNextPage: false });
    await callerAs('editor@example.com').blog.list({ status: 'all' });
    expect(mocks.findAll).toHaveBeenCalledWith(expect.objectContaining({ status: 'all' }));
  });
});

describe('content.canEdit', () => {
  it('is true only for a listed editor', async () => {
    await expect(callerAs('editor@example.com').canEdit()).resolves.toBe(true);
    await expect(callerAs('other@example.com').canEdit()).resolves.toBe(false);
  });
});
