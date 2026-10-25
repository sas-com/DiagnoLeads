import { GET } from '@/app/api/health/route';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The uptime check: answers without touching the database or anything else that can fail

describe('GET /api/health', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('answers 200 with the status, the time and the package version', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T01:02:03.000Z'));
    vi.stubEnv('npm_package_version', '2.3.4');

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      timestamp: '2026-10-25T01:02:03.000Z',
      version: '2.3.4',
    });
  });

  it('reports 2.0.0 when the package version is not given (as on Vercel)', async () => {
    vi.stubEnv('npm_package_version', '');

    const res = await GET();

    expect((await res.json()).version).toBe('2.0.0');
  });
});
