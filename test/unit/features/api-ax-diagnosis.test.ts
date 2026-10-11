/**
 * AX migration diagnosis API route tests
 * The real route handler is imported; DB access and notifications are mocked.
 */
import { NextRequest } from 'next/server';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const submitMock = vi.fn();
const notifyMock = vi.fn();
const resolveOrgMock = vi.fn();
// Tasks given to after(): run by the test once the response is there
const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as Array<() => unknown> }));
const runAfterTasks = () => Promise.all(afterTasks.map((task) => task()));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    afterTasks.push(task);
  },
}));
vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/features/diagnostics/ax-migration/notify', () => ({
  notifyAxMigrationSubmission: (...args: unknown[]) => notifyMock(...args),
}));
vi.mock('@/lib/features/diagnostics/organization', () => ({
  resolveDiagnosisOrganizationId: () => resolveOrgMock(),
}));
vi.mock('@/lib/features/diagnostics/ax-migration/submission-service', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/features/diagnostics/ax-migration/submission-service')>();
  return {
    ...original,
    submitAxMigrationDiagnosis: (...args: unknown[]) => submitMock(...args),
  };
});

const { POST } = await import('@/app/api/diagnostics/ax-migration/route');
const { evaluateAxMigration } = await import('@/lib/features/diagnostics/ax-migration/evaluate');

const ORG_ID = '11111111-1111-4111-8111-111111111111';

const validBody = {
  answers: { industry: 'manufacturing' },
  contact: { company: '三田製作所', name: '山田', email: 'yamada@example.jp' },
  privacyConsent: true,
  consultationRequested: true,
  tracking: { utmMedium: 'cpc' },
  locale: 'ja',
};

const request = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/diagnostics/ax-migration', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });

const fullAnswers = as400Answers;

const result = evaluateAxMigration(as400Answers);

describe('POST /api/diagnostics/ax-migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterTasks.length = 0;
    resolveOrgMock.mockReturnValue(ORG_ID);
    notifyMock.mockResolvedValue(undefined);
  });

  it('returns the public result and notifies sales', async () => {
    submitMock.mockResolvedValue({
      ok: true,
      submissionId: 'sub-1',
      leadId: 'lead-1',
      leadCreated: true,
      existingLead: null,
      result,
      answers: {},
    });

    const response = await POST(request(validBody));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.submissionId).toBe('sub-1');
    expect(json.result.difficulty).toEqual(result.difficulty);
    // Sales-only fields are never sent to the respondent
    expect(json.result).not.toHaveProperty('leadScore');
    expect(json.result).not.toHaveProperty('mql');
    expect(json).not.toHaveProperty('leadId');

    expect(submitMock).toHaveBeenCalledWith({}, ORG_ID, expect.objectContaining({ consultationRequested: true }));
    // Sales are notified after the response, not before it
    expect(notifyMock).not.toHaveBeenCalled();
    await runAfterTasks();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        leadId: 'lead-1',
        consultationRequested: true,
        identityUnverified: false,
        company: '三田製作所',
      })
    );
  });

  it('rejects requests without privacy consent', async () => {
    const response = await POST(request({ ...validBody, privacyConsent: false }));
    expect(response.status).toBe(400);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('answers a filled honeypot with a fake success and stores nothing', async () => {
    const response = await POST(
      request({ ...validBody, answers: fullAnswers, website: 'http://spam.example' })
    );
    expect(response.status).toBe(200);
    expect((await response.json()).result.difficulty).toBeDefined();
    expect(submitMock).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(0);
  });

  it('accepts an empty honeypot', async () => {
    submitMock.mockResolvedValue({
      ok: true,
      submissionId: 'sub-3',
      leadId: 'lead-3',
      leadCreated: true,
      existingLead: null,
      result,
      answers: {},
    });
    const response = await POST(request({ ...validBody, website: '' }));
    expect(response.status).toBe(200);
    expect(submitMock).toHaveBeenCalled();
  });

  it('rejects non-JSON requests that cross-site forms could send', async () => {
    const response = await POST(request(validBody, { 'content-type': 'text/plain' }));
    expect(response.status).toBe(415);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('rejects requests from another origin', async () => {
    const response = await POST(request(validBody, { origin: 'https://evil.example' }));
    expect(response.status).toBe(403);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('allows same-origin requests', async () => {
    submitMock.mockResolvedValue({
      ok: true,
      submissionId: 'sub-4',
      leadId: 'lead-4',
      leadCreated: true,
      existingLead: null,
      result,
      answers: {},
    });
    const response = await POST(request(validBody, { origin: 'http://localhost' }));
    expect(response.status).toBe(200);
  });

  it('rejects oversized bodies', async () => {
    const response = await POST(request(validBody, { 'content-length': String(64 * 1024) }));
    expect(response.status).toBe(413);
  });

  it('notifies sales with the stored identity when the email matches an existing lead', async () => {
    submitMock.mockResolvedValue({
      ok: true,
      submissionId: 'sub-5',
      leadId: 'lead-existing',
      leadCreated: false,
      existingLead: { name: '登録済み 花子', company: '登録済み商事', email: 'yamada@example.jp' },
      result,
      answers: {},
    });
    const response = await POST(request(validBody));
    expect(response.status).toBe(200);
    await runAfterTasks();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        company: '登録済み商事',
        name: '登録済み 花子',
        identityUnverified: true,
        leadCreated: false,
      })
    );
  });

  it('caps the number of validation issues returned', async () => {
    submitMock.mockResolvedValue({
      ok: false,
      issues: Array.from({ length: 50 }, (_, i) => ({ questionId: `q${i}`, code: 'unknown_question' })),
    });
    const response = await POST(request(validBody));
    expect((await response.json()).issues).toHaveLength(20);
  });

  it('returns 500 when saving fails', async () => {
    submitMock.mockRejectedValue(new Error('db down'));
    const response = await POST(request(validBody));
    expect(response.status).toBe(500);
  });

  it('rejects malformed JSON', async () => {
    const response = await POST(request('{not json'));
    expect(response.status).toBe(400);
  });

  it('returns 400 with issues when answers are invalid', async () => {
    submitMock.mockResolvedValue({ ok: false, issues: [{ questionId: 'system', code: 'required' }] });
    const response = await POST(request(validBody));
    expect(response.status).toBe(400);
    expect((await response.json()).issues).toEqual([{ questionId: 'system', code: 'required' }]);
    expect(afterTasks).toHaveLength(0);
  });

  it('returns 503 when no receiving organization is configured', async () => {
    resolveOrgMock.mockReturnValue(null);
    const response = await POST(request(validBody));
    expect(response.status).toBe(503);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('still answers the respondent when notification fails', async () => {
    submitMock.mockResolvedValue({
      ok: true,
      submissionId: 'sub-2',
      leadId: 'lead-2',
      leadCreated: false,
      existingLead: null,
      result,
      answers: {},
    });
    notifyMock.mockRejectedValue(new Error('smtp down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await POST(request(validBody));
    expect(response.status).toBe(200);
    // The failure is caught inside the task, so nothing is left unhandled
    await expect(runAfterTasks()).resolves.toEqual([undefined]);
    expect(errorSpy).toHaveBeenCalledWith('AX diagnosis notification error:', expect.any(Error));
    errorSpy.mockRestore();
  });

  it('takes the request time before the response, for the consultation deadline', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-09T14:59:59Z'), toFake: ['Date'] });
    try {
      submitMock.mockResolvedValue({
        ok: true,
        submissionId: 'sub-8',
        leadId: 'lead-8',
        leadCreated: true,
        existingLead: null,
        result,
        answers: {},
      });
      await POST(request(validBody));
      // The response is out; the tasks run later (here: after midnight in Japan)
      vi.setSystemTime(new Date('2026-10-09T15:00:05Z'));
      await runAfterTasks();
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ requestedAt: new Date('2026-10-09T14:59:59Z') })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
