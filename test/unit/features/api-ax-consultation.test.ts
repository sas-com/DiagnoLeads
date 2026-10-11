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

// after() needs a request scope; here the task runs right away
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    void task();
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
    notifyMock.mockResolvedValue(undefined);
    findLead.mockResolvedValue({ id: 'lead-1', company: 'DB商事', name: 'DB 太郎', email: 'db@example.jp' });
    findSubmission.mockResolvedValue({ id: SUBMISSION_ID, result: { difficulty: { level: 'medium' } } });
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
    });
    await POST(request({ submissionId: SUBMISSION_ID }));
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
    expect(notifyMock).not.toHaveBeenCalled();
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
