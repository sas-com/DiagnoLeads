/**
 * AX migration consultation API route tests
 * The real route handler is imported; DB access and notifications are mocked.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();
const notifyMock = vi.fn();
const findLead = vi.fn();
const findSubmission = vi.fn();
const limitMock = vi.fn();

// Tasks given to after(): run by the test once the response is there
const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as Array<() => unknown> }));
const runAfterTasks = () => Promise.all(afterTasks.map((task) => task()));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    afterTasks.push(task);
  },
}));
vi.mock('@/lib/db/client', () => ({
  db: {
    query: {
      leads: { findFirst: (...args: unknown[]) => findLead(...args) },
      diagnosticSubmissions: { findFirst: (...args: unknown[]) => findSubmission(...args) },
    },
  },
}));
vi.mock('@/lib/features/diagnostics/ax-migration/notify', () => ({
  notifyAxMigrationSubmission: (...args: unknown[]) => notifyMock(...args),
}));
vi.mock('@/lib/features/diagnostics/ax-migration/submission-service', () => ({
  requestAxMigrationConsultation: (...args: unknown[]) => requestMock(...args),
}));
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({
  consumeRateLimit: (...args: unknown[]) => limitMock(...args),
}));

const { POST } = await import('@/app/api/diagnostics/ax-migration/consultation/route');

const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/diagnostics/ax-migration/consultation', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('POST /api/diagnostics/ax-migration/consultation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterTasks.length = 0;
    notifyMock.mockResolvedValue(undefined);
    findLead.mockResolvedValue({ id: 'lead-1', company: 'DB商事', name: 'DB 太郎', email: 'db@example.jp' });
    findSubmission.mockResolvedValue({ id: SUBMISSION_ID, result: { difficulty: { level: 'medium' } } });
    limitMock.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  });

  it('answers 429 over the per-address limit', async () => {
    limitMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });
    const response = await POST(request({ submissionId: SUBMISSION_ID }));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('treats another system of the respondent who created the lead as verified', async () => {
    requestMock.mockResolvedValue({
      ok: true,
      alreadyRequested: false,
      organizationId: 'org-1',
      leadId: 'lead-1',
      leadCreated: false,
      continued: true,
    });
    await POST(request({ submissionId: SUBMISSION_ID }));
    await runAfterTasks();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ identityUnverified: false, additionalSystem: true })
    );
  });

  it('notifies sales on the first request with the stored lead identity', async () => {
    requestMock.mockResolvedValue({
      ok: true,
      alreadyRequested: false,
      organizationId: 'org-1',
      leadId: 'lead-1',
      leadCreated: true,
    });
    const response = await POST(request({ submissionId: SUBMISSION_ID }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, alreadyRequested: false });
    // The lead is read and sales are notified after the response
    expect(findLead).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    await runAfterTasks();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        leadId: 'lead-1',
        company: 'DB商事',
        consultationRequested: true,
        identityUnverified: false,
      })
    );
  });

  it('marks the identity as unverified when the submission matched an existing lead', async () => {
    requestMock.mockResolvedValue({
      ok: true,
      alreadyRequested: false,
      organizationId: 'org-1',
      leadId: 'lead-1',
      leadCreated: false,
      continued: false,
    });
    await POST(request({ submissionId: SUBMISSION_ID }));
    await runAfterTasks();
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ identityUnverified: true }));
  });

  it('does not notify again for a repeated request', async () => {
    requestMock.mockResolvedValue({
      ok: true,
      alreadyRequested: true,
      organizationId: 'org-1',
      leadId: 'lead-1',
      leadCreated: true,
    });
    const response = await POST(request({ submissionId: SUBMISSION_ID }));
    expect(await response.json()).toEqual({ ok: true, alreadyRequested: true });
    expect(afterTasks).toHaveLength(0);
  });

  it('skips the notification when the lead was deleted', async () => {
    requestMock.mockResolvedValue({
      ok: true,
      alreadyRequested: false,
      organizationId: 'org-1',
      leadId: null,
      leadCreated: true,
    });
    const response = await POST(request({ submissionId: SUBMISSION_ID }));
    expect(response.status).toBe(200);
    expect(afterTasks).toHaveLength(0);
  });

  it('answers the respondent even when the lookups for the message fail', async () => {
    requestMock.mockResolvedValue({
      ok: true,
      alreadyRequested: false,
      organizationId: 'org-1',
      leadId: 'lead-1',
      leadCreated: true,
    });
    findLead.mockRejectedValue(new Error('db blip'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await POST(request({ submissionId: SUBMISSION_ID }));
    expect(response.status).toBe(200);
    await expect(runAfterTasks()).resolves.toEqual([undefined]);
    expect(notifyMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('AX consultation notification error:', expect.any(Error));
    errorSpy.mockRestore();
  });

  it('skips the notification when the lead is gone by the time it is sent', async () => {
    requestMock.mockResolvedValue({
      ok: true,
      alreadyRequested: false,
      organizationId: 'org-1',
      leadId: 'lead-1',
      leadCreated: true,
    });
    findLead.mockResolvedValue(undefined);
    await POST(request({ submissionId: SUBMISSION_ID }));
    await runAfterTasks();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown submission', async () => {
    requestMock.mockResolvedValue({ ok: false, reason: 'not_found' });
    const response = await POST(request({ submissionId: SUBMISSION_ID }));
    expect(response.status).toBe(404);
  });

  it('returns 400 for a malformed submission id', async () => {
    const response = await POST(request({ submissionId: 'not-a-uuid' }));
    expect(response.status).toBe(400);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('rejects requests from another origin', async () => {
    const response = await POST(
      request({ submissionId: SUBMISSION_ID }, { origin: 'https://evil.example' })
    );
    expect(response.status).toBe(403);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the service fails', async () => {
    requestMock.mockRejectedValue(new Error('db down'));
    const response = await POST(request({ submissionId: SUBMISSION_ID }));
    expect(response.status).toBe(500);
  });
});
