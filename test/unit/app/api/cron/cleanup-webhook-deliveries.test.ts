import { GET } from '@/app/api/cron/cleanup-webhook-deliveries/route';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { cleanupOldDeliveries, processWebhookRetries, reportServerError } = vi.hoisted(() => ({
  cleanupOldDeliveries: vi.fn(),
  processWebhookRetries: vi.fn(),
  reportServerError: vi.fn(),
}));
vi.mock('@/lib/features/webhooks/services/webhook-service', () => ({
  cleanupOldDeliveries,
  processWebhookRetries,
}));
vi.mock('@/lib/ops/alert', () => ({ reportServerError }));

const RETRIES = { processed: 2, succeeded: 1, failed: 1, exhausted: 0 };

const call = (authorization?: string) =>
  GET(
    new Request('https://app.example/api/cron/cleanup-webhook-deliveries', {
      headers: authorization ? { authorization } : {},
    })
  );

describe('daily clean-up of webhook deliveries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanupOldDeliveries.mockResolvedValue(3);
    processWebhookRetries.mockResolvedValue(RETRIES);
    reportServerError.mockResolvedValue(undefined);
    vi.stubEnv('CRON_SECRET', 'cron-secret-value');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('sends due retries and deletes deliveries older than 30 days when Vercel Cron calls it', async () => {
    const res = await call('Bearer cron-secret-value');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 3, retries: RETRIES });
    expect(processWebhookRetries).toHaveBeenCalledTimes(1);
    expect(cleanupOldDeliveries).toHaveBeenCalledWith(30);
    expect(reportServerError).not.toHaveBeenCalled();
  });

  it('reports a failed retry run, still cleans up, and fails the run', async () => {
    const error = new Error('db down');
    processWebhookRetries.mockRejectedValue(error);
    await expect(call('Bearer cron-secret-value')).rejects.toBe(error);
    expect(reportServerError).toHaveBeenCalledWith('cron/webhook-retries', error);
    expect(cleanupOldDeliveries).toHaveBeenCalledWith(30);
  });

  it('reports a failed clean-up, still sends retries, and fails the run', async () => {
    const error = new Error('db down');
    cleanupOldDeliveries.mockRejectedValue(error);
    await expect(call('Bearer cron-secret-value')).rejects.toBe(error);
    expect(reportServerError).toHaveBeenCalledWith('cron/cleanup-webhook-deliveries', error);
    expect(processWebhookRetries).toHaveBeenCalledTimes(1);
  });

  it('refuses anyone else', async () => {
    for (const authorization of [undefined, 'Bearer wrong', 'cron-secret-value', 'Bearer cron-secret-valuX', 'bearer cron-secret-value']) {
      expect((await call(authorization)).status).toBe(401);
    }
    expect(cleanupOldDeliveries).not.toHaveBeenCalled();
    expect(processWebhookRetries).not.toHaveBeenCalled();
  });

  it('refuses everyone while CRON_SECRET is not set', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call('Bearer ')).status).toBe(401);
    expect((await call('Bearer undefined')).status).toBe(401);
    expect(cleanupOldDeliveries).not.toHaveBeenCalled();
  });
});
