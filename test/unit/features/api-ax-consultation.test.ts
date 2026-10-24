/**
 * AX migration consultation API route tests
 * The real route handler is imported; DB access and notifications are mocked.
 */
import {
  MAX_TOPIC_NOTE_LENGTH,
  MEETING_ATTENDEE_ROLES,
  MEETING_TOPICS,
} from '@/lib/features/meeting-requests/types/schemas';
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
const acceptMock = vi.fn();
vi.mock('@/lib/features/meeting-requests/service', () => ({
  acceptMeetingPreferences: (...args: unknown[]) => acceptMock(...args),
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
    limitMock.mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 0 });
  });

  it('answers 429 over the per-address limit', async () => {
    vi.stubEnv('VERCEL', '1');
    try {
      limitMock.mockResolvedValue({ allowed: false, count: 11, retryAfterSeconds: 60 });
      const response = await POST(
        request({ submissionId: SUBMISSION_ID }, { 'x-real-ip': '2001:db8:aa:bb::9' })
      );
      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('60');
      expect(limitMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: 'ax-consultation-ip' }),
        // Per /64 for IPv6
        '2001:0db8:00aa:00bb::/64'
      );
      expect(requestMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('does not count per address where the address cannot be trusted', async () => {
    requestMock.mockResolvedValue({ ok: false, reason: 'not_found' });
    await POST(request({ submissionId: SUBMISSION_ID }, { 'x-real-ip': '2001:db8:aa:bb::9' }));
    expect(limitMock).not.toHaveBeenCalled();
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

  it('returns 409 once the result screen window has closed (#232)', async () => {
    requestMock.mockResolvedValue({ ok: false, reason: 'closed' });
    const response = await POST(request({ submissionId: SUBMISSION_ID }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'closed' });
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
  describe('with first meeting preferences (#155)', () => {
    const preferences = {
      candidates: [{ date: '2030-01-08', time: '10:00' }],
      attendeeRoles: ['executive'],
      meetingFormat: 'online',
    };

    it('records them on the lead after the request, and says what happened', async () => {
      const requestedAt = new Date('2030-01-06T01:00:00Z');
      requestMock.mockResolvedValue({
        ok: true,
        alreadyRequested: true,
        organizationId: 'org-1',
        leadId: 'lead-1',
        leadCreated: true,
        continued: false,
        requestedAt,
      });
      acceptMock.mockResolvedValue('saved');
      const response = await POST(request({ submissionId: SUBMISSION_ID, preferences }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, alreadyRequested: true, preferences: 'saved' });
      expect(acceptMock).toHaveBeenCalledWith(
        expect.anything(),
        {
          organizationId: 'org-1',
          leadId: 'lead-1',
          submissionId: SUBMISSION_ID,
          identityVerified: true,
          // The window for the preferences runs from the earlier consultation request (#241)
          requestedAt,
          // Topics and the note default to none (#244)
          preferences: { ...preferences, topics: [], topicNote: null },
        },
        expect.any(Function)
      );
      // Already requested: sales were told then, not again
      expect(notifyMock).not.toHaveBeenCalled();
    });

    it('times the preferences sent with the first request from that request (#241)', async () => {
      const requestedAt = new Date('2030-01-06T01:00:00Z');
      requestMock.mockResolvedValue({
        ok: true,
        alreadyRequested: false,
        organizationId: 'org-1',
        leadId: 'lead-1',
        leadCreated: true,
        continued: false,
        requestedAt,
      });
      acceptMock.mockResolvedValue('saved');
      await POST(request({ submissionId: SUBMISSION_ID, preferences }));
      expect(acceptMock.mock.calls[0][1]).toMatchObject({ requestedAt });
    });

    it('marks an answer tied to an existing lead by email only as unverified', async () => {
      requestMock.mockResolvedValue({
        ok: true,
        alreadyRequested: true,
        organizationId: 'org-1',
        leadId: 'lead-1',
        leadCreated: false,
        continued: false,
      });
      acceptMock.mockResolvedValue('unavailable');
      const response = await POST(request({ submissionId: SUBMISSION_ID, preferences }));
      expect(await response.json()).toEqual({
        ok: true,
        alreadyRequested: true,
        preferences: 'unavailable',
      });
      expect(acceptMock.mock.calls[0][1]).toMatchObject({ identityVerified: false });
    });

    it('treats a continued answer as verified', async () => {
      requestMock.mockResolvedValue({
        ok: true,
        alreadyRequested: true,
        organizationId: 'org-1',
        leadId: 'lead-1',
        leadCreated: false,
        continued: true,
      });
      acceptMock.mockResolvedValue('saved');
      await POST(request({ submissionId: SUBMISSION_ID, preferences }));
      expect(acceptMock.mock.calls[0][1]).toMatchObject({ identityVerified: true });
    });

    it('refuses preferences that do not fit the form', async () => {
      const response = await POST(
        request({
          submissionId: SUBMISSION_ID,
          preferences: { ...preferences, candidates: [{ date: '2030-01-08', time: '07:00' }] },
        })
      );
      expect(response.status).toBe(400);
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('passes the topics and the trimmed note on (#244)', async () => {
      requestMock.mockResolvedValue({
        ok: true,
        alreadyRequested: true,
        organizationId: 'org-1',
        leadId: 'lead-1',
        leadCreated: true,
        continued: false,
      });
      acceptMock.mockResolvedValue('saved');
      const response = await POST(
        request({
          submissionId: SUBMISSION_ID,
          preferences: { ...preferences, topics: ['cost', 'other'], topicNote: '  予算の相談  ' },
        })
      );
      expect(response.status).toBe(200);
      expect(acceptMock.mock.calls[0][1].preferences).toEqual({
        ...preferences,
        topics: ['cost', 'other'],
        topicNote: '予算の相談',
      });
    });

    it('refuses unknown or repeated topics and a note over 300 characters (#244)', async () => {
      for (const extra of [
        { topics: ['pricing'] },
        { topics: ['cost', 'cost'] },
        { topicNote: 'あ'.repeat(301) },
      ]) {
        const response = await POST(
          request({ submissionId: SUBMISSION_ID, preferences: { ...preferences, ...extra } })
        );
        expect(response.status).toBe(400);
      }
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('refuses a NUL or a bidi override in the note (#244)', async () => {
      for (const topicNote of ['予算\u0000', '予算\u202e逆']) {
        const response = await POST(
          request({ submissionId: SUBMISSION_ID, preferences: { ...preferences, topicNote } })
        );
        expect(response.status).toBe(400);
      }
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('takes the largest body the form can send within 2 KB (#244)', async () => {
      requestMock.mockResolvedValue({
        ok: true,
        alreadyRequested: true,
        organizationId: 'org-1',
        leadId: 'lead-1',
        leadCreated: true,
        continued: false,
      });
      acceptMock.mockResolvedValue('saved');
      const largest = {
        submissionId: SUBMISSION_ID,
        preferences: {
          candidates: ['10:00', '10:30', '11:00'].map((time) => ({ date: '2030-01-08', time })),
          attendeeRoles: [...MEETING_ATTENDEE_ROLES],
          meetingFormat: 'onsite',
          topics: [...MEETING_TOPICS],
          // 3 bytes a character, the most an allowed character takes in JSON
          topicNote: 'あ'.repeat(MAX_TOPIC_NOTE_LENGTH),
        },
      };
      const size = new TextEncoder().encode(JSON.stringify(largest)).length;
      expect(size).toBeLessThan(2048);
      const response = await POST(request(largest, { 'content-length': String(size) }));
      expect(response.status).toBe(200);
    });

    it('still refuses a body over 2 KB', async () => {
      const response = await POST(request({ submissionId: SUBMISSION_ID, padding: 'x'.repeat(2100) }));
      expect(response.status).toBe(413);
    });

    it('leaves the preferences out of the answer when none were sent', async () => {
      requestMock.mockResolvedValue({
        ok: true,
        alreadyRequested: true,
        organizationId: 'org-1',
        leadId: 'lead-1',
        leadCreated: true,
        continued: false,
      });
      const response = await POST(request({ submissionId: SUBMISSION_ID }));
      expect(await response.json()).toEqual({ ok: true, alreadyRequested: true });
      expect(acceptMock).not.toHaveBeenCalled();
    });
  });
});
