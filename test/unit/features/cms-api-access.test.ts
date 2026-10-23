/**
 * CMS admin APIs are for signed-in CMS users only (Refs #80).
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as unknown,
  authError: null as Error | null,
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

const { requireCmsUser } = await import('@/lib/cms/require-cms-user');

const request = (path: string) => new NextRequest(`https://example.com${path}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = null;
  mocks.authError = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('requireCmsUser', () => {
  it('lets a signed-in CMS user through', async () => {
    mocks.user = { id: 'u1', collection: 'cms-users' };
    expect(await requireCmsUser(request('/api/cms/subscribe'))).toBeNull();
  });

  it('answers 401 without a session', async () => {
    const res = await requireCmsUser(request('/api/cms/subscribe'));
    expect(res?.status).toBe(401);
  });

  it('fails closed when the session check throws', async () => {
    mocks.authError = new Error('db down');
    const res = await requireCmsUser(request('/api/cms/subscribe'));
    expect(res?.status).toBe(401);
  });
});

describe('CMS routes without a CMS session', () => {
  it('subscribe is 401', async () => {
    const { GET } = await import('@/app/api/cms/subscribe/route');
    expect((await GET(request('/api/cms/subscribe'))).status).toBe(401);
  });
});
