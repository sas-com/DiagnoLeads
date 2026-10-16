import { GET } from '@/app/api/cron/cleanup-webhook-deliveries/route';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cleanupOldDeliveries = vi.hoisted(() => vi.fn());
vi.mock('@/lib/features/webhooks/services/webhook-service', () => ({ cleanupOldDeliveries }));

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
    vi.stubEnv('CRON_SECRET', 'cron-secret-value');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('deletes deliveries older than 30 days when Vercel Cron calls it', async () => {
    const res = await call('Bearer cron-secret-value');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 3 });
    expect(cleanupOldDeliveries).toHaveBeenCalledWith(30);
  });

  it('refuses anyone else', async () => {
    for (const authorization of [undefined, 'Bearer wrong', 'cron-secret-value', 'Bearer cron-secret-valuX', 'bearer cron-secret-value']) {
      expect((await call(authorization)).status).toBe(401);
    }
    expect(cleanupOldDeliveries).not.toHaveBeenCalled();
  });

  it('refuses everyone while CRON_SECRET is not set', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call('Bearer ')).status).toBe(401);
    expect((await call('Bearer undefined')).status).toBe(401);
    expect(cleanupOldDeliveries).not.toHaveBeenCalled();
  });
});
