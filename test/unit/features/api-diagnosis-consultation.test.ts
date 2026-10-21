/**
 * Builder diagnosis consultation API route: the first meeting preferences it passes on (#155),
 * with the topics and the note of #244. The real route handler is imported; DB access,
 * notifications and the meeting service are mocked.
 */
import {
  MAX_TOPIC_NOTE_LENGTH,
  MEETING_ATTENDEE_ROLES,
  MEETING_TOPICS,
} from '@/lib/features/meeting-requests/types/schemas';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();
const acceptMock = vi.fn();

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}));
vi.mock('@/lib/db/client', () => ({ db: { query: { leads: { findFirst: vi.fn() } } } }));
vi.mock('@/lib/features/diagnosis-builder/notify', () => ({
  notifyDiagnosisSubmission: vi.fn(),
}));
vi.mock('@/lib/features/diagnosis-builder/public-diagnosis', () => ({
  findPublicDiagnosis: vi.fn().mockResolvedValue({ id: 'diagnosis-1' }),
}));
vi.mock('@/lib/features/diagnosis-builder/submission-service', () => ({
  findBuilderSubmission: vi.fn(),
  mqlReasonTexts: vi.fn(),
  requestBuilderConsultation: (...args: unknown[]) => requestMock(...args),
  resultTypeName: vi.fn(),
}));
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({
  consumeRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('@/lib/features/meeting-requests/service', () => ({
  acceptMeetingPreferences: (...args: unknown[]) => acceptMock(...args),
}));

const { POST } = await import('@/app/api/diagnoses/[slug]/consultation/route');

const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';
const params = { params: Promise.resolve({ slug: 'sample' }) };
const request = (body: unknown) =>
  new NextRequest('http://localhost/api/diagnoses/sample/consultation', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
const preferences = {
  candidates: [{ date: '2030-01-08', time: '10:00' }],
  attendeeRoles: ['executive'],
  meetingFormat: 'online',
};

describe('POST /api/diagnoses/[slug]/consultation with meeting preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestMock.mockResolvedValue({
      ok: true,
      alreadyRequested: true,
      organizationId: 'org-1',
      leadId: 'lead-1',
      leadCreated: true,
    });
    acceptMock.mockResolvedValue('saved');
  });

  it('passes the topics and the trimmed note on, verified only when the answer made the lead', async () => {
    const response = await POST(
      request({
        submissionId: SUBMISSION_ID,
        preferences: { ...preferences, topics: ['schedule'], topicNote: ' 来期から ' },
      }),
      params
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, alreadyRequested: true, preferences: 'saved' });
    expect(acceptMock.mock.calls[0][1]).toEqual({
      organizationId: 'org-1',
      leadId: 'lead-1',
      submissionId: SUBMISSION_ID,
      identityVerified: true,
      preferences: { ...preferences, topics: ['schedule'], topicNote: '来期から' },
    });

    requestMock.mockResolvedValue({
      ok: true,
      alreadyRequested: true,
      organizationId: 'org-1',
      leadId: 'lead-1',
      leadCreated: false,
    });
    await POST(request({ submissionId: SUBMISSION_ID, preferences }), params);
    expect(acceptMock.mock.calls[1][1]).toMatchObject({
      identityVerified: false,
      preferences: { topics: [], topicNote: null },
    });
  });

  it('refuses unknown or repeated topics and a note over 300 characters', async () => {
    for (const extra of [
      { topics: ['pricing'] },
      { topics: ['cost', 'cost'] },
      { topicNote: 'あ'.repeat(301) },
    ]) {
      const response = await POST(
        request({ submissionId: SUBMISSION_ID, preferences: { ...preferences, ...extra } }),
        params
      );
      expect(response.status).toBe(400);
    }
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('refuses a NUL or a bidi override in the note', async () => {
    for (const topicNote of ['予算\u0000', '予算\u202e逆']) {
      const response = await POST(
        request({ submissionId: SUBMISSION_ID, preferences: { ...preferences, topicNote } }),
        params
      );
      expect(response.status).toBe(400);
    }
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('takes the largest body the form can send and refuses one over 2 KB', async () => {
    const largest = {
      submissionId: SUBMISSION_ID,
      preferences: {
        ...preferences,
        attendeeRoles: [...MEETING_ATTENDEE_ROLES],
        topics: [...MEETING_TOPICS],
        topicNote: 'あ'.repeat(MAX_TOPIC_NOTE_LENGTH),
      },
    };
    expect(new TextEncoder().encode(JSON.stringify(largest)).length).toBeLessThan(2048);
    expect((await POST(request(largest), params)).status).toBe(200);

    const tooLarge = await POST(
      request({ submissionId: SUBMISSION_ID, padding: 'x'.repeat(2100) }),
      params
    );
    expect(tooLarge.status).toBe(413);
  });
});
