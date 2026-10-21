/**
 * Embedded lead form in test mode: an address outside the company domain is refused and no lead
 * is stored.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { insertValues, findConfig } = vi.hoisted(() => ({
  insertValues: vi.fn(),
  findConfig: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    query: { embedConfigs: { findFirst: findConfig } },
    insert: () => ({
      values: (row: unknown) => {
        insertValues(row);
        return { returning: async () => [{ id: 'lead-1' }] };
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));
vi.mock('@/lib/features/embed/security', () => ({
  checkRateLimit: () => ({ allowed: true, remaining: 10, resetAt: new Date() }),
  getRateLimitHeaders: () => ({}),
  getSecurityHeaders: () => ({}),
  hashIpAddress: () => 'hash',
  isOriginAllowed: () => true,
  sanitizeHtml: (value: string) => value,
  validateCsrfToken: () => true,
}));

const request = (email: string) =>
  new NextRequest('http://localhost:3000/api/embed/v1/lead', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://partner.example',
      'x-diagnoleads-key': 'pk_test',
      'x-csrf-token': 'token',
    },
    body: JSON.stringify({ email, name: '山田', csrfToken: 'token' }),
  });

describe('embedded lead form in test mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findConfig.mockResolvedValue({
      id: 'cfg-1',
      organizationId: 'org-1',
      isActive: true,
      expiresAt: null,
      allowedOrigins: ['https://partner.example'],
      rateLimitPerMinute: 10,
      rateLimitPerDay: 100,
    });
    process.env.APP_TEST_MODE = 'true';
    // The API is off unless enabled (2026-10-21); these tests are about the enabled API
    vi.stubEnv('EMBED_API_ENABLED', 'true');
  });
  afterEach(() => {
    delete process.env.APP_TEST_MODE;
    vi.unstubAllEnvs();
  });

  it('refuses an address outside the company domain and stores no lead', async () => {
    const { POST } = await import('@/app/api/embed/v1/lead/route');

    const res = await POST(request('someone@gmail.com'));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'EMAIL_DOMAIN_NOT_ALLOWED' });
    const leadRows = insertValues.mock.calls.filter(([row]) => (row as { email?: string }).email);
    expect(leadRows).toHaveLength(0);
  });

  it('accepts a company address', async () => {
    const { POST } = await import('@/app/api/embed/v1/lead/route');

    const res = await POST(request('tokumoto@sas-com.com'));

    expect(res.status).not.toBe(400);
    expect(insertValues.mock.calls.some(([row]) => (row as { email?: string }).email === 'tokumoto@sas-com.com')).toBe(true);
  });
});
