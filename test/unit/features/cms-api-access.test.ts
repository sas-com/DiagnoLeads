/**
 * CMS admin APIs are for signed-in CMS users only (Refs #80).
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as unknown,
  authError: null as Error | null,
  generate: vi.fn(),
  findAll: vi.fn(),
}));

vi.mock('@payload-config', () => ({ default: {} }));
vi.mock('payload', () => ({
  getPayload: async () => ({
    auth: async () => {
      if (mocks.authError) throw mocks.authError;
      return { user: mocks.user };
    },
  }),
}));
vi.mock('@/lib/cms/ai/content-generator', () => ({
  getAIContentGenerator: () => ({ generate: mocks.generate }),
}));
vi.mock('@/lib/cms', () => ({
  BlogRepository: class {
    findAll = mocks.findAll;
  },
  FAQRepository: class {},
}));

const { requireCmsUser } = await import('@/lib/cms/require-cms-user');

const request = (path: string, init?: { method?: string; body?: string }) =>
  new NextRequest(`https://example.com${path}`, init);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = null;
  mocks.authError = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('requireCmsUser', () => {
  it('lets a signed-in CMS user through', async () => {
    mocks.user = { id: 'u1', collection: 'cms-users' };
    expect(await requireCmsUser(request('/api/cms/figma'))).toBeNull();
  });

  it('answers 401 without a session', async () => {
    const res = await requireCmsUser(request('/api/cms/figma'));
    expect(res?.status).toBe(401);
  });

  it('fails closed when the session check throws', async () => {
    mocks.authError = new Error('db down');
    const res = await requireCmsUser(request('/api/cms/figma'));
    expect(res?.status).toBe(401);
  });
});

describe('CMS routes without a CMS session', () => {
  it('ai-generate is 401 and never calls the AI', async () => {
    const { POST } = await import('@/app/api/cms/ai-generate/route');
    const res = await POST(
      request('/api/cms/ai-generate', { method: 'POST', body: JSON.stringify({ type: 'faq' }) })
    );
    expect(res.status).toBe(401);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('figma GET and POST are 401', async () => {
    const { GET, POST } = await import('@/app/api/cms/figma/route');
    expect((await GET(request('/api/cms/figma'))).status).toBe(401);
    const res = await POST(
      request('/api/cms/figma', { method: 'POST', body: JSON.stringify({ action: 'get-file' }) })
    );
    expect(res.status).toBe(401);
  });

  it('subscribe is 401', async () => {
    const { GET } = await import('@/app/api/cms/subscribe/route');
    expect((await GET(request('/api/cms/subscribe'))).status).toBe(401);
  });

  it('figma webhook GET is 401', async () => {
    const { GET } = await import('@/app/api/cms/figma/webhook/route');
    expect((await GET(request('/api/cms/figma/webhook'))).status).toBe(401);
  });
});

describe('figma webhook without FIGMA_WEBHOOK_SECRET', () => {
  it('rejects posts instead of skipping the signature check', async () => {
    vi.stubEnv('FIGMA_WEBHOOK_SECRET', '');
    const { POST } = await import('@/app/api/cms/figma/webhook/route');
    const res = await POST(
      request('/api/cms/figma/webhook', {
        method: 'POST',
        body: JSON.stringify({ event_type: 'FILE_UPDATE' }),
      })
    );
    expect(res.status).toBe(401);
    vi.unstubAllEnvs();
  });
});

describe('cms-users read access', () => {
  it('is limited to signed-in CMS users', async () => {
    const { Users } = await import('@/cms/collections/Users');
    const read = Users.access?.read as (args: { req: { user: unknown } }) => boolean;
    expect(read({ req: { user: null } })).toBe(false);
    expect(read({ req: { user: { id: 'u1' } } })).toBe(true);
  });
});

describe('content.blog.list', () => {
  it('returns only published posts to anonymous callers, whatever status they ask for', async () => {
    mocks.findAll.mockResolvedValue({ posts: [], total: 0, hasNextPage: false });
    const { contentRouter } = await import('@/lib/features/content/api/router');
    // biome-ignore lint/suspicious/noExplicitAny: anonymous tRPC context
    const caller = contentRouter.createCaller({ session: null, user: null } as any);

    await caller.blog.list({ status: 'all' });

    expect(mocks.findAll).toHaveBeenCalledWith(expect.objectContaining({ status: 'published' }));
  });

  it('keeps the requested status for signed-in users', async () => {
    mocks.findAll.mockResolvedValue({ posts: [], total: 0, hasNextPage: false });
    const { contentRouter } = await import('@/lib/features/content/api/router');
    // biome-ignore lint/suspicious/noExplicitAny: signed-in tRPC context
    const caller = contentRouter.createCaller({ session: {}, user: { id: 'u1' } } as any);

    await caller.blog.list({ status: 'all' });

    expect(mocks.findAll).toHaveBeenCalledWith(expect.objectContaining({ status: 'all' }));
  });
});
