/**
 * The public embed API is off unless EMBED_API_ENABLED=true (2026-10-21, before the AX launch):
 * every handler answers 404 and touches nothing.
 */
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dbCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/lib/db', () => ({
  db: new Proxy(
    {},
    {
      get: () => {
        dbCalls.count += 1;
        throw new Error('the database must not be used while the API is off');
      },
    }
  ),
}));

import { GET as diagnosticGet, OPTIONS as diagnosticOptions } from '@/app/api/embed/v1/diagnostic/route';
import { OPTIONS as leadOptions, POST as leadPost } from '@/app/api/embed/v1/lead/route';

const request = (path: string, method: string) =>
  new NextRequest(`https://diagnoleads.example${path}`, {
    method,
    headers: { origin: 'https://partner.example', 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify({ email: 'a@example.com' }) : undefined,
  });

afterEach(() => vi.unstubAllEnvs());

describe('embed API while off', () => {
  it.each([
    ['lead POST', () => leadPost(request('/api/embed/v1/lead', 'POST'))],
    ['lead OPTIONS', () => leadOptions(request('/api/embed/v1/lead', 'OPTIONS'))],
    ['diagnostic GET', () => diagnosticGet(request('/api/embed/v1/diagnostic?key=x', 'GET'))],
    ['diagnostic OPTIONS', () => diagnosticOptions(request('/api/embed/v1/diagnostic', 'OPTIONS'))],
  ])('%s answers 404 without the database', async (_name, call) => {
    vi.stubEnv('EMBED_API_ENABLED', '');
    const response = await call();
    expect(response.status).toBe(404);
    expect(dbCalls.count).toBe(0);
  });

  it('stays off for any value other than true', async () => {
    vi.stubEnv('EMBED_API_ENABLED', '1');
    expect((await leadPost(request('/api/embed/v1/lead', 'POST'))).status).toBe(404);
  });
});
