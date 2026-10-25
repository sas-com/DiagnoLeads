import { GET } from '@/app/api/cron/notify-due-tasks/route';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The daily notices (vercel.json, 23:00 UTC): "when to act" first, then the due next actions and
// takeaways (#85), then the appointment reviews due (#149). Only Vercel Cron may run it.

const {
  recomputeRecentlyUpdated,
  runAppointmentReviewNotices,
  runDueTaskNotifications,
  reportServerError,
} = vi.hoisted(() => ({
  recomputeRecentlyUpdated: vi.fn(),
  runAppointmentReviewNotices: vi.fn(),
  runDueTaskNotifications: vi.fn(),
  reportServerError: vi.fn(),
}));
vi.mock('@/lib/features/act-timing/service', () => ({ recomputeRecentlyUpdated }));
vi.mock('@/lib/features/appointment-reviews/service', () => ({ runAppointmentReviewNotices }));
vi.mock('@/lib/features/lead-follow-up/due-notifications', () => ({ runDueTaskNotifications }));
vi.mock('@/lib/ops/alert', () => ({ reportServerError }));
const { db } = vi.hoisted(() => ({ db: { marker: 'db' } }));
vi.mock('@/lib/db/client', () => ({ db }));

const DUE = { organizations: 2, notices: 5, emails: 3 };
const REVIEWS = { notices: 1 };
const ACT_TIMING = { recomputed: 7 };

const call = (authorization?: string) =>
  GET(
    new Request('https://app.example/api/cron/notify-due-tasks', {
      headers: authorization ? { authorization } : {},
    })
  );

describe('GET /api/cron/notify-due-tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recomputeRecentlyUpdated.mockResolvedValue(ACT_TIMING);
    runDueTaskNotifications.mockResolvedValue(DUE);
    runAppointmentReviewNotices.mockResolvedValue(REVIEWS);
    reportServerError.mockResolvedValue(undefined);
    vi.stubEnv('CRON_SECRET', 'cron-secret-value');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('recomputes when to act, then sends both kinds of notices with the shared database', async () => {
    const res = await call('Bearer cron-secret-value');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...DUE,
      appointmentReviews: REVIEWS,
      actTiming: ACT_TIMING,
    });
    expect(recomputeRecentlyUpdated).toHaveBeenCalledWith(db);
    expect(runDueTaskNotifications).toHaveBeenCalledWith(db);
    expect(runAppointmentReviewNotices).toHaveBeenCalledWith(db);
    // Next actions made by the recompute exist before their notices go out
    expect(recomputeRecentlyUpdated.mock.invocationCallOrder[0]).toBeLessThan(
      runDueTaskNotifications.mock.invocationCallOrder[0]
    );
    expect(reportServerError).not.toHaveBeenCalled();
  });

  it('still sends the notices when the recompute fails, and reports it', async () => {
    const error = new Error('db timeout');
    recomputeRecentlyUpdated.mockRejectedValue(error);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await call('Bearer cron-secret-value');

    expect(res.status).toBe(200);
    expect((await res.json()).actTiming).toEqual({ error: 'failed' });
    expect(runDueTaskNotifications).toHaveBeenCalledTimes(1);
    expect(runAppointmentReviewNotices).toHaveBeenCalledTimes(1);
    expect(reportServerError).toHaveBeenCalledWith('cron/act-timing', error);
    errorSpy.mockRestore();
  });

  it('still answers with the due notices when the appointment review notices fail, and reports it', async () => {
    const error = new Error('mail down');
    runAppointmentReviewNotices.mockRejectedValue(error);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await call('Bearer cron-secret-value');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...DUE,
      appointmentReviews: { error: 'failed' },
      actTiming: ACT_TIMING,
    });
    expect(reportServerError).toHaveBeenCalledWith('cron/appointment-review-notices', error);
    errorSpy.mockRestore();
  });

  it('reports a failed run of the due notices and fails the run without the review notices', async () => {
    const error = new Error('db down');
    runDueTaskNotifications.mockRejectedValue(error);

    await expect(call('Bearer cron-secret-value')).rejects.toBe(error);
    expect(reportServerError).toHaveBeenCalledWith('cron/notify-due-tasks', error);
    expect(runAppointmentReviewNotices).not.toHaveBeenCalled();
  });

  it.each([
    ['no header', undefined],
    ['a wrong secret', 'Bearer wrong'],
    ['the secret without the scheme', 'cron-secret-value'],
    ['a secret of the same length that differs', 'Bearer cron-secret-valuX'],
    ['a lower-case scheme', 'bearer cron-secret-value'],
  ])('refuses %s with 401 and runs nothing', async (_label, authorization) => {
    const res = await call(authorization);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(recomputeRecentlyUpdated).not.toHaveBeenCalled();
    expect(runDueTaskNotifications).not.toHaveBeenCalled();
    expect(runAppointmentReviewNotices).not.toHaveBeenCalled();
  });

  it('refuses everyone while CRON_SECRET is not set', async () => {
    vi.stubEnv('CRON_SECRET', '');

    expect((await call('Bearer ')).status).toBe(401);
    expect((await call('Bearer undefined')).status).toBe(401);
    expect(runDueTaskNotifications).not.toHaveBeenCalled();
  });
});
