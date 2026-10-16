/**
 * The legacy generic diagnosis form is off in production unless explicitly enabled (#71).
 */
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const env: { LEGACY_DIAGNOSTIC_FORM_ENABLED?: string } = {};
const insert = vi.fn();

vi.mock('@/lib/env', () => ({ env }));
vi.mock('@/lib/db/client', () => ({ db: { insert, select: vi.fn(), query: {} } }));

const { isLegacyDiagnosticFormEnabled } = await import(
  '@/lib/features/diagnostics/legacy-form'
);
const { POST } = await import('@/app/api/diagnostic/route');

afterEach(() => {
  vi.unstubAllEnvs();
  env.LEGACY_DIAGNOSTIC_FORM_ENABLED = undefined;
});

describe('isLegacyDiagnosticFormEnabled', () => {
  it('is off in production by default', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(isLegacyDiagnosticFormEnabled()).toBe(false);
  });

  it('can be turned back on in production', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    env.LEGACY_DIAGNOSTIC_FORM_ENABLED = 'true';
    expect(isLegacyDiagnosticFormEnabled()).toBe(true);
  });

  it.each(['preview', 'development', ''])('stays on for VERCEL_ENV=%s', (value) => {
    vi.stubEnv('VERCEL_ENV', value);
    expect(isLegacyDiagnosticFormEnabled()).toBe(true);
  });
});

describe('POST /api/diagnostic in production', () => {
  it('answers 410 and stores nothing', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const res = await POST(
      new NextRequest('https://example.com/api/diagnostic', {
        method: 'POST',
        body: JSON.stringify({ email: 'someone@example.com', name: 'x' }),
      })
    );
    expect(res.status).toBe(410);
    expect(insert).not.toHaveBeenCalled();
  });
});
