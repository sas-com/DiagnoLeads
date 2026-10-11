/**
 * AX migration follow-up answers API route tests
 * The real route handler is imported; the submission service is mocked.
 */
import { evaluateAxMigration } from '@/lib/features/diagnostics/ax-migration/evaluate';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const addDetailsMock = vi.fn();
const limitMock = vi.fn();

vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({
  consumeRateLimit: (...args: unknown[]) => limitMock(...args),
}));
vi.mock('@/lib/features/diagnostics/ax-migration/submission-service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/features/diagnostics/ax-migration/submission-service')>();
  return {
    axMigrationDetailsSchema: actual.axMigrationDetailsSchema,
    addAxMigrationDetails: (...args: unknown[]) => addDetailsMock(...args),
  };
});

const { POST } = await import('@/app/api/diagnostics/ax-migration/details/route');

const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/diagnostics/ax-migration/details', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('POST /api/diagnostics/ax-migration/details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitMock.mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 0 });
  });

  it('answers 429 over the per-address limit', async () => {
    vi.stubEnv('VERCEL', '1');
    try {
      limitMock.mockResolvedValue({ allowed: false, count: 21, retryAfterSeconds: 30 });
      const response = await POST(
        request(
          { submissionId: SUBMISSION_ID, answers: { gaiji: 'many' } },
          { 'x-real-ip': '2001:db8:aa:bb::9' }
        )
      );
      expect(response.status).toBe(429);
      expect(limitMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: 'ax-details-ip' }),
        // Per /64 for IPv6
        '2001:0db8:00aa:00bb::/64'
      );
      expect(addDetailsMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('returns the refined public result', async () => {
    const result = evaluateAxMigration({ ...as400Answers, gaiji: 'many' });
    addDetailsMock.mockResolvedValue({ ok: true, result });

    const response = await POST(
      request({ submissionId: SUBMISSION_ID, answers: { gaiji: 'many' } })
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.result.difficulty).toEqual(result.difficulty);
    // The sales judgement stays on the server
    expect(json.result).not.toHaveProperty('leadScore');
    expect(json.result).not.toHaveProperty('mql');
    expect(addDetailsMock).toHaveBeenCalledWith(expect.anything(), SUBMISSION_ID, { gaiji: 'many' });
  });

  it('rejects a body without a valid submission id', async () => {
    const response = await POST(request({ submissionId: 'nope', answers: {} }));
    expect(response.status).toBe(400);
    expect(addDetailsMock).not.toHaveBeenCalled();
  });

  it('passes on answer issues', async () => {
    addDetailsMock.mockResolvedValue({
      ok: false,
      reason: 'invalid',
      issues: [{ questionId: 'maintenance', code: 'not_applicable' }],
    });
    const response = await POST(
      request({ submissionId: SUBMISSION_ID, answers: { maintenance: 'team' } })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).issues).toEqual([
      { questionId: 'maintenance', code: 'not_applicable' },
    ]);
  });

  it.each([
    ['not_found', 404],
    ['outdated', 409],
  ] as const)('answers %s with %i', async (reason, status) => {
    addDetailsMock.mockResolvedValue({ ok: false, reason });
    const response = await POST(request({ submissionId: SUBMISSION_ID, answers: { gaiji: 'none' } }));
    expect(response.status).toBe(status);
  });

  it('rejects requests from another origin', async () => {
    const response = await POST(
      request({ submissionId: SUBMISSION_ID, answers: {} }, { origin: 'https://evil.example' })
    );
    expect(response.status).toBe(403);
    expect(addDetailsMock).not.toHaveBeenCalled();
  });

  it('returns 500 without details when the service fails', async () => {
    addDetailsMock.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await POST(request({ submissionId: SUBMISSION_ID, answers: { gaiji: 'none' } }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
    errorSpy.mockRestore();
  });
});
