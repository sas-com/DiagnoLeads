/**
 * POST /api/diagnoses/[slug]/submit (builder diagnoses, #116)
 * The real route and submission service run; the version lookup, lead matching, rate limits,
 * Turnstile and notifications are mocked, and the database is a recording fake.
 */
import { validateDiagnosisAnswers } from '@/lib/features/diagnosis-builder/answers';
import {
  evaluate,
  toPublicResult,
  withConsultationSignal,
} from '@/lib/features/diagnosis-builder/evaluate';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudReadiness } from '../../fixtures/diagnosis-builder';

const { afterTasks, calls, inserted, updated, fakeDb } = vi.hoisted(() => {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const tx = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserted.push(values);
        return { returning: async () => [{ id: '99999999-9999-4999-8999-999999999999' }] };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updated.push(values);
        return { where: async () => undefined };
      },
    }),
  };
  return {
    afterTasks: [] as Array<() => unknown>,
    calls: [] as string[],
    inserted,
    updated,
    fakeDb: { transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) },
  };
});
const runAfterTasks = () => Promise.all(afterTasks.map((task) => task()));

const resolveMock = vi.fn();
const upsertMock = vi.fn();
const notifyMock = vi.fn();
const limitsMock = vi.fn();
const turnstileMock = vi.fn();
const siteKeyMock = vi.fn();

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    afterTasks.push(task);
  },
}));
vi.mock('@/lib/db/client', () => ({ db: fakeDb }));
vi.mock('@/lib/features/diagnosis-builder/public-diagnosis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/diagnosis-builder/public-diagnosis')>()),
  resolveSubmittedVersion: (...args: unknown[]) => {
    calls.push('version');
    return resolveMock(...args);
  },
}));
vi.mock('@/lib/features/diagnostics/lead-upsert', () => ({
  upsertLeadFromSubmission: (...args: unknown[]) => {
    calls.push('save');
    return upsertMock(...args);
  },
}));
vi.mock('@/lib/features/diagnosis-builder/notify', () => ({
  notifyDiagnosisSubmission: (...args: unknown[]) => notifyMock(...args),
}));
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({
  consumeRateLimits: (...args: unknown[]) => {
    calls.push('limits');
    return limitsMock(...args);
  },
  pruneRateLimits: async () => undefined,
}));
vi.mock('@/lib/features/diagnostics/turnstile', () => ({
  turnstileSiteKey: () => siteKeyMock(),
  verifyTurnstile: (...args: unknown[]) => {
    calls.push('turnstile');
    return turnstileMock(...args);
  },
}));

const { POST } = await import('@/app/api/diagnoses/[slug]/submit/route');

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const DIAGNOSIS_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';

const definition = cloudReadiness();
const version = { id: VERSION_ID, version: 2, definition, publishedAt: new Date() };
const diagnosis = {
  id: DIAGNOSIS_ID,
  organizationId: ORG_ID,
  slug: 'cloud-check',
  name: '架空のクラウド準備度',
  current: version,
};

const answers = { hosting: 'cloud', team_size: 150, practices: ['iac'], confidence: 5 };

const validBody = {
  versionId: VERSION_ID,
  answers,
  contact: { company: '架空商事', name: '試験 太郎', email: 'taro@example.co.jp' },
  privacyConsent: true,
  consentVersion: '2026-10-01',
  consultationRequested: true,
  tracking: { utmMedium: 'cpc' },
  locale: 'ja',
  turnstileToken: 'token',
};

const request = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/diagnoses/cloud-check/submit', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
const params = { params: Promise.resolve({ slug: 'cloud-check' }) };
const post = (body: unknown, headers?: Record<string, string>) =>
  POST(request(body, headers), params);

/** What the server computes for validBody (a consultation request is a strong signal, #139) */
const serverEvaluation = () => {
  const validated = validateDiagnosisAnswers(definition, answers);
  if (!validated.success) throw new Error('fixture answers are invalid');
  const scored = evaluate(definition, validated.answers);
  return { ...scored, mql: withConsultationSignal(scored.mql) };
};

const validateOk = () => {
  const validated = validateDiagnosisAnswers(definition, answers);
  if (!validated.success) throw new Error('fixture answers are invalid');
  return validated.answers;
};

describe('POST /api/diagnoses/[slug]/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterTasks.length = 0;
    calls.length = 0;
    inserted.length = 0;
    updated.length = 0;
    resolveMock.mockResolvedValue({ ok: true, diagnosis, version });
    upsertMock.mockResolvedValue({ leadId: 'lead-1', existing: undefined });
    notifyMock.mockResolvedValue(undefined);
    limitsMock.mockResolvedValue({ allowed: true });
    siteKeyMock.mockReturnValue('site-key');
    turnstileMock.mockResolvedValue({ ok: true });
  });

  it('runs the checks in order, saves with the server score and returns the public result', async () => {
    const response = await post(validBody);
    expect(response.status).toBe(200);
    expect(calls).toEqual(['version', 'turnstile', 'limits', 'save']);

    const expected = serverEvaluation();
    const json = await response.json();
    expect(json).toEqual({
      submissionId: '99999999-9999-4999-8999-999999999999',
      consultationRequested: true,
      result: toPublicResult(expected),
    });
    expect(json.result).not.toHaveProperty('leadScore');
    expect(json.result).not.toHaveProperty('mql');

    expect(resolveMock).toHaveBeenCalledWith(fakeDb, 'cloud-check', VERSION_ID, expect.any(Date));
    expect(turnstileMock).toHaveBeenCalledWith('token', undefined, 'localhost', 'diagnosis');
    // Organization from the diagnosis row; lead values from the server's evaluation
    expect(upsertMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG_ID,
        email: 'taro@example.co.jp',
        newLead: expect.objectContaining({
          score: expected.leadScore.points,
          conversionPoint: 'consultation',
          mqlQualifiedAt: expected.mql.qualified ? expect.any(Date) : null,
        }),
      })
    );
    expect(inserted[0]).toMatchObject({
      organizationId: ORG_ID,
      leadId: 'lead-1',
      leadCreated: true,
      diagnosticKey: `d:${DIAGNOSIS_ID}`,
      diagnosticVersion: 2,
      diagnosisVersionId: VERSION_ID,
      consent: { version: '2026-10-01', agreedAt: expect.any(String) },
      consultationRequestedAt: expect.any(Date),
      result: expected,
    });
    expect(updated[0]).toMatchObject({
      responses: {
        diagnosis: {
          diagnosisId: DIAGNOSIS_ID,
          version: 2,
          leadScore: expected.leadScore.points,
          leadScoreReasons: ['担当者が100人以上'],
          mqlLevel: 'interest',
          mqlQualified: true,
          mqlReasons: ['相談申込'],
          consultationRequested: true,
        },
      },
    });

    // Sales are notified after the response
    expect(notifyMock).not.toHaveBeenCalled();
    await runAfterTasks();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        diagnosisId: DIAGNOSIS_ID,
        leadId: 'lead-1',
        company: '架空商事',
        consultationRequested: true,
        identityUnverified: false,
        leadScore: expected.leadScore.points,
        mqlLevel: 'interest',
        mqlReasons: ['相談申込'],
      })
    );
    // Fit without the request: 適合 only
    expect(evaluate(definition, validateOk()).mql.level).toBe('fit');
  });

  it('ignores points, scores and results sent by the respondent', async () => {
    const response = await post({
      ...validBody,
      score: 100,
      leadScore: 100,
      mql: { qualified: true },
      result: { overall: 100, leadScore: { points: 100, reasons: ['偽'] } },
      answers: { ...answers },
    });
    expect(response.status).toBe(200);
    const expected = serverEvaluation();
    expect(expected.leadScore.points).not.toBe(100);
    expect(upsertMock.mock.calls[0][1].newLead.score).toBe(expected.leadScore.points);
    expect(inserted[0].result).toEqual(expected);
    expect((await response.json()).result).toEqual(toPublicResult(expected));
  });

  it('rejects points sent inside the answers', async () => {
    const response = await post({ ...validBody, answers: { ...answers, points: 100 } });
    expect(response.status).toBe(400);
    expect((await response.json()).issues).toEqual([
      { questionId: 'points', code: 'unknown_question' },
    ]);
    expect(calls).toEqual(['version']);
  });

  it('answers a filled honeypot like a success before parsing, and touches nothing', async () => {
    const response = await post({ website: 'http://spam.example', answers: 'not even valid' });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.submissionId).toEqual(expect.any(String));
    expect(json.result).toEqual({ axes: {}, overall: 0, tiers: {}, resultTypeId: null });
    expect(calls).toEqual([]);
    expect(afterTasks).toHaveLength(0);
  });

  it('accepts an empty honeypot', async () => {
    const response = await post({ ...validBody, website: '' });
    expect(response.status).toBe(200);
    expect(calls).toContain('save');
  });

  it('rejects an invalid body before looking up the diagnosis', async () => {
    const response = await post({ ...validBody, privacyConsent: false });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('rejects requests from another origin and non-JSON bodies first', async () => {
    expect((await post(validBody, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(validBody, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post(validBody, { 'content-length': String(64 * 1024 + 1) })).status).toBe(413);
    expect(calls).toEqual([]);
  });

  it('404 for a diagnosis that is not published', async () => {
    resolveMock.mockResolvedValue({ ok: false, reason: 'not_found' });
    const response = await post(validBody);
    expect(response.status).toBe(404);
    expect(calls).toEqual(['version']);
  });

  it('409 for a version that is neither current nor replaced within 24 hours', async () => {
    resolveMock.mockResolvedValue({ ok: false, reason: 'outdated' });
    const response = await post(validBody);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'version_outdated' });
    expect(calls).toEqual(['version']);
  });

  it('checks invalid answers before Turnstile and the limits', async () => {
    const response = await post({ ...validBody, answers: { hosting: 'cloud' } });
    expect(response.status).toBe(400);
    expect(calls).toEqual(['version']);
  });

  it('Turnstile is required: 503 when it is not configured', async () => {
    siteKeyMock.mockReturnValue(undefined);
    const response = await post(validBody);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'verification_unavailable' });
    expect(calls).toEqual(['version']);
  });

  it('403 when the Turnstile check fails, before anything is counted', async () => {
    turnstileMock.mockResolvedValue({ ok: false, reason: 'missing' });
    const response = await post({ ...validBody, turnstileToken: undefined });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'verification_failed' });
    expect(calls).toEqual(['version', 'turnstile']);
  });

  it('429 with Retry-After when a DB rate limit is reached, and nothing is saved', async () => {
    limitsMock.mockResolvedValue({ allowed: false, rule: 'dx-submit-email', retryAfterSeconds: 120 });
    const response = await post(validBody);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('120');
    expect(calls).toEqual(['version', 'turnstile', 'limits']);
    expect(inserted).toHaveLength(0);
  });

  it('counts per IP block and per email', async () => {
    await post(validBody, { 'x-real-ip': '203.0.113.7' });
    const rules = limitsMock.mock.calls[0][1].map((r: { rule: { name: string } }) => r.rule.name);
    expect(rules).toContain('dx-submit-email');
  });

  it('in test mode, refuses an address outside the company domain before the lookup', async () => {
    process.env.APP_TEST_MODE = 'true';
    try {
      const response = await post({
        ...validBody,
        contact: { ...validBody.contact, email: 'someone@gmail.com' },
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'email_domain_not_allowed' });
      expect(calls).toEqual([]);
    } finally {
      delete process.env.APP_TEST_MODE;
    }
  });

  it('an existing lead is only linked: no lead update, sales told the identity is unverified', async () => {
    upsertMock.mockResolvedValue({
      leadId: 'lead-old',
      existing: { id: 'lead-old', name: '既存 花子', company: '既存社', email: 'taro@example.co.jp' },
    });
    const response = await post(validBody);
    expect(response.status).toBe(200);
    expect(inserted[0]).toMatchObject({ leadId: 'lead-old', leadCreated: false });
    expect(updated).toHaveLength(0);
    await runAfterTasks();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ company: '既存社', name: '既存 花子', identityUnverified: true })
    );
  });
});
