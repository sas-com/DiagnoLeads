import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock database
vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 'delivery-1' }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  },
}));

// Mock fetch
global.fetch = vi.fn();

import { db } from '@/lib/db/client';
import {
  WEBHOOK_DELIVERY_LEASE_MS,
  WEBHOOK_DELIVERY_TIMEOUT_MS,
  INVALID_HEADERS_ERROR,
  cleanupOldDeliveries,
  describeRequestError,
  generateWebhookSecret,
  generateWebhookSignature,
  processWebhookRetries,
  sendWebhookDelivery,
  triggerWebhooks,
  verifyWebhookSignature,
} from '@/lib/features/webhooks/services/webhook-service';

describe('webhook-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-08T12:00:00Z'));
  });

  describe('generateWebhookSignature', () => {
    it('should generate signature with timestamp', () => {
      const payload = '{"test": "data"}';
      const secret = 'whsec_test_secret';

      const signature = generateWebhookSignature(payload, secret);

      expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]+$/);
    });

    it('should generate different signatures for different payloads', () => {
      const secret = 'whsec_test_secret';
      const sig1 = generateWebhookSignature('payload1', secret);
      const sig2 = generateWebhookSignature('payload2', secret);

      expect(sig1).not.toBe(sig2);
    });

    it('should generate different signatures for different secrets', () => {
      const payload = '{"test": "data"}';
      const sig1 = generateWebhookSignature(payload, 'secret1');
      const sig2 = generateWebhookSignature(payload, 'secret2');

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('should verify valid signature', () => {
      const payload = '{"test": "data"}';
      const secret = 'whsec_test_secret';
      const signature = generateWebhookSignature(payload, secret);

      const isValid = verifyWebhookSignature(payload, signature, secret);

      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const payload = '{"test": "data"}';
      const isValid = verifyWebhookSignature(payload, 't=123,v1=invalid', 'secret');

      expect(isValid).toBe(false);
    });

    it('should reject expired signature', () => {
      const payload = '{"test": "data"}';
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const signature = `t=${oldTimestamp},v1=somesignature`;

      const isValid = verifyWebhookSignature(payload, signature, 'secret', 300);

      expect(isValid).toBe(false);
    });

    it('should reject malformed signature', () => {
      const payload = '{"test": "data"}';

      expect(verifyWebhookSignature(payload, 'invalid', 'secret')).toBe(false);
      expect(verifyWebhookSignature(payload, 't=123', 'secret')).toBe(false);
      expect(verifyWebhookSignature(payload, 'v1=abc', 'secret')).toBe(false);
    });

    it('should handle custom tolerance', () => {
      const payload = '{"test": "data"}';
      const secret = 'whsec_test_secret';
      const signature = generateWebhookSignature(payload, secret);

      // Should be valid within 5 minutes
      expect(verifyWebhookSignature(payload, signature, secret, 300)).toBe(true);
    });
  });

  describe('generateWebhookSecret', () => {
    it('should generate secret with correct prefix', () => {
      const secret = generateWebhookSecret();
      expect(secret).toMatch(/^whsec_[a-f0-9]{64}$/);
    });

    it('should generate unique secrets', () => {
      const secret1 = generateWebhookSecret();
      const secret2 = generateWebhookSecret();
      expect(secret1).not.toBe(secret2);
    });
  });

  describe('triggerWebhooks', () => {
    it('should return zeros when no webhooks found', async () => {
      (db.where as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await triggerWebhooks('org-1', 'lead.created', { leadId: 'lead-1' });

      expect(result).toEqual({ triggered: 0, failed: 0 });
    });

    it('should trigger webhooks for subscribed events', async () => {
      const mockWebhook = {
        id: 'webhook-1',
        organizationId: 'org-1',
        url: 'https://example.com/webhook',
        secret: 'whsec_test',
        events: ['lead.created'],
        status: 'active',
        headers: {},
        retryConfig: { maxRetries: 3, retryDelayMs: 5000 },
        failureCount: 0,
      };

      (db.where as ReturnType<typeof vi.fn>).mockResolvedValue([mockWebhook]);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue('{"success": true}'),
      });

      const result = await triggerWebhooks('org-1', 'lead.created', { leadId: 'lead-1' });

      expect(result.triggered).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('should not trigger webhooks for unsubscribed events', async () => {
      const mockWebhook = {
        id: 'webhook-1',
        events: ['lead.updated'], // Not subscribed to lead.created
        status: 'active',
      };

      (db.where as ReturnType<typeof vi.fn>).mockResolvedValue([mockWebhook]);

      const result = await triggerWebhooks('org-1', 'lead.created', { leadId: 'lead-1' });

      expect(result.triggered).toBe(0);
    });

    it('should handle delivery failure', async () => {
      const mockWebhook = {
        id: 'webhook-1',
        url: 'https://example.com/webhook',
        secret: 'whsec_test',
        events: ['lead.created'],
        status: 'active',
        headers: {},
        retryConfig: { maxRetries: 3, retryDelayMs: 5000 },
        failureCount: 0,
      };

      (db.where as ReturnType<typeof vi.fn>).mockResolvedValue([mockWebhook]);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: vi.fn().mockResolvedValue('Error'),
      });

      const result = await triggerWebhooks('org-1', 'lead.created', { leadId: 'lead-1' });

      expect(result.failed).toBe(1);
    });

    it('should handle network errors', async () => {
      const mockWebhook = {
        id: 'webhook-1',
        url: 'https://example.com/webhook',
        secret: 'whsec_test',
        events: ['lead.created'],
        status: 'active',
        headers: {},
        retryConfig: { maxRetries: 3, retryDelayMs: 5000 },
        failureCount: 0,
      };

      (db.where as ReturnType<typeof vi.fn>).mockResolvedValue([mockWebhook]);
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

      const result = await triggerWebhooks('org-1', 'lead.created', { leadId: 'lead-1' });

      expect(result.failed).toBe(1);
    });
  });

  describe('delivery timing (#69)', () => {
    const webhook = (id: string) => ({
      id,
      organizationId: 'org-1',
      url: `https://example.com/${id}`,
      secret: 'whsec_test',
      events: ['lead.created'],
      status: 'active',
      headers: {},
      retryConfig: { maxRetries: 3, retryDelayMs: 5000 },
      failureCount: 0,
    });
    const okResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue('ok'),
    };
    const flush = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };

    it('gives up an attempt after 8 seconds', async () => {
      expect(WEBHOOK_DELIVERY_TIMEOUT_MS).toBe(8000);
      (db.where as ReturnType<typeof vi.fn>).mockResolvedValue([webhook('webhook-1')]);
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          })
      );

      let result: { triggered: number; failed: number } | undefined;
      void triggerWebhooks('org-1', 'lead.created', {}).then((r) => {
        result = r;
      });
      await vi.advanceTimersByTimeAsync(WEBHOOK_DELIVERY_TIMEOUT_MS - 1);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(result).toEqual({ triggered: 0, failed: 1 });
    });

    it('sends to all endpoints in parallel', async () => {
      (db.where as ReturnType<typeof vi.fn>).mockResolvedValue([
        webhook('webhook-1'),
        webhook('webhook-2'),
        webhook('webhook-3'),
      ]);
      const pending: Array<() => void> = [];
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise((resolve) => {
            pending.push(() => resolve(okResponse));
          })
      );

      const run = triggerWebhooks('org-1', 'lead.created', {});
      await flush();
      // All three requests are open before any of them has answered
      expect(global.fetch).toHaveBeenCalledTimes(3);
      for (const answer of pending) answer();
      await expect(run).resolves.toEqual({ triggered: 3, failed: 0 });
    });

    it('a failure to record one delivery does not stop the others', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      (db.where as ReturnType<typeof vi.fn>).mockResolvedValue([
        webhook('webhook-1'),
        webhook('webhook-2'),
      ]);
      (db.returning as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('insert failed'))
        .mockResolvedValueOnce([{ id: 'delivery-2' }]);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(okResponse);

      await expect(triggerWebhooks('org-1', 'lead.created', {})).resolves.toEqual({
        triggered: 1,
        failed: 1,
      });
    });

    it('stores the delivery as due for retry before sending it', async () => {
      (db.where as ReturnType<typeof vi.fn>).mockResolvedValue([webhook('webhook-1')]);
      (db.returning as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'delivery-1' }]);
      let sentAfterInsert = false;
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        sentAfterInsert = (db.values as ReturnType<typeof vi.fn>).mock.calls.length === 1;
        return okResponse;
      });

      await triggerWebhooks('org-1', 'lead.created', {});

      expect(sentAfterInsert).toBe(true);
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
          attempts: 1,
          nextRetryAt: new Date(Date.now() + WEBHOOK_DELIVERY_LEASE_MS),
        })
      );
      // On success the retry time is cleared
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success', nextRetryAt: null, attempts: 1 })
      );
    });

    it('on failure moves the retry time by the configured delay', async () => {
      (db.where as ReturnType<typeof vi.fn>).mockResolvedValue([webhook('webhook-1')]);
      (db.returning as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'delivery-1' }]);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Unavailable',
        text: vi.fn().mockResolvedValue(''),
      });

      await triggerWebhooks('org-1', 'lead.created', {});

      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
          attempts: 1,
          nextRetryAt: new Date(Date.now() + 5000),
        })
      );
    });

    it('fails the delivery at once when maxRetries allows a single attempt', async () => {
      (db.where as ReturnType<typeof vi.fn>).mockResolvedValue([
        { ...webhook('webhook-1'), retryConfig: { maxRetries: 1, retryDelayMs: 5000 } },
      ]);
      (db.returning as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'delivery-1' }]);
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('refused'));

      await triggerWebhooks('org-1', 'lead.created', {});

      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', attempts: 1, nextRetryAt: null })
      );
    });
  });

  describe('sendWebhookDelivery (#314)', () => {
    // Made-up values: the stored headers are sent as-is, only the browser never sees them
    const webhook = {
      id: 'webhook-1',
      organizationId: 'org-1',
      name: 'CRM',
      url: 'https://hooks.example.com/one',
      secret: 'whsec_test',
      events: ['lead.created' as const],
      status: 'inactive' as const,
      headers: { Authorization: 'Bearer made-up-token-314', 'X-Tenant': 'tenant-made-up' },
      retryConfig: { maxRetries: 3, retryDelayMs: 5000 },
      lastTriggeredAt: null,
      failureCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('sends one delivery to the given webhook with the stored header values', async () => {
      (db.returning as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'delivery-1' }]);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue('ok'),
      });

      await expect(sendWebhookDelivery(webhook, 'lead.created', { test: true })).resolves.toEqual({
        success: true,
      });

      // No lookup of other webhooks subscribed to the event
      expect(db.select).not.toHaveBeenCalled();
      expect(db.values).toHaveBeenCalledTimes(1);
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ webhookId: 'webhook-1', eventType: 'lead.created' })
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://hooks.example.com/one');
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer made-up-token-314',
        'X-Tenant': 'tenant-made-up',
      });
    });
  });

  describe('request headers and error text (#314)', () => {
    const SECRET_VALUE = 'Bearer made-up-token-314';
    const base = {
      id: 'webhook-1',
      organizationId: 'org-1',
      name: 'CRM',
      url: 'https://hooks.example.com/one',
      secret: 'whsec_test',
      events: ['lead.created' as const],
      status: 'active' as const,
      retryConfig: { maxRetries: 3, retryDelayMs: 5000 },
      lastTriggeredAt: null,
      failureCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const ok = { ok: true, status: 200, statusText: 'OK', text: vi.fn().mockResolvedValue('') };
    const storedErrors = () =>
      (db.set as ReturnType<typeof vi.fn>).mock.calls
        .map(([values]) => (values as { error?: unknown }).error)
        .filter((e) => e !== undefined);
    const sentHeaders = () =>
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers as Record<string, string>;

    beforeEach(() => {
      (db.returning as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'delivery-1' }]);
    });

    it('stores a fixed message, not the value, when a stored header cannot be sent', async () => {
      // Saved before values were checked
      const webhook = { ...base, headers: { Authorization: `${SECRET_VALUE}\r\nX-Evil: 1` } };

      await expect(sendWebhookDelivery(webhook, 'lead.created', {})).resolves.toEqual({
        success: false,
      });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(storedErrors()).toEqual([INVALID_HEADERS_ERROR]);
    });

    it('never stores the raw message of a network error', async () => {
      const webhook = { ...base, headers: { Authorization: SECRET_VALUE } };
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new TypeError(`Headers.append: "${SECRET_VALUE}" is an invalid header value`)
      );

      await sendWebhookDelivery(webhook, 'lead.created', {});

      expect(storedErrors()).toEqual(['Network error']);
    });

    it('describes failures with fixed texts and a system code only', () => {
      const refused = new TypeError('fetch failed made-up-token');
      (refused as { cause?: unknown }).cause = Object.assign(new Error('connect made-up-token'), {
        code: 'ECONNREFUSED',
      });
      expect(describeRequestError(refused)).toBe('Network error (ECONNREFUSED)');
      expect(describeRequestError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(
        'Request timed out'
      );
      // A code that is not a plain identifier is not copied
      expect(describeRequestError(Object.assign(new Error('x'), { code: 'made-up token' }))).toBe(
        'Network error'
      );
      expect(describeRequestError('made-up-token')).toBe('Network error');
    });

    it("skips stored reserved names, so the delivery's own headers are sent", async () => {
      // Saved before names were checked
      const webhook = {
        ...base,
        headers: {
          'x-webhook-signature': 'forged',
          'content-type': 'text/plain',
          Host: 'internal.example.com',
          Authorization: SECRET_VALUE,
        },
      };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(ok);

      await sendWebhookDelivery(webhook, 'lead.created', {});

      const headers = sentHeaders();
      expect(Object.keys(headers).map((n) => n.toLowerCase()).sort()).toEqual([
        'authorization',
        'content-type',
        'user-agent',
        'x-webhook-event',
        'x-webhook-id',
        'x-webhook-signature',
      ]);
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Webhook-Signature']).toMatch(/^t=\d+,v1=/);
      expect(headers.Authorization).toBe(SECRET_VALUE);
    });

    it('skips a stored __proto__ header without losing the others (N2)', async () => {
      // jsonb comes back through JSON.parse, which makes __proto__ an own key
      const webhook = {
        ...base,
        headers: JSON.parse(
          '{"__proto__":"made-up-proto","X-Tenant":"tenant-made-up"}'
        ) as Record<string, string>,
      };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(ok);

      await sendWebhookDelivery(webhook, 'lead.created', {});

      expect(Object.keys(sentHeaders())).not.toContain('__proto__');
      expect(sentHeaders()['X-Tenant']).toBe('tenant-made-up');
    });
  });

  describe('processWebhookRetries', () => {
    it('should be a function', () => {
      expect(typeof processWebhookRetries).toBe('function');
    });
  });

  describe('cleanupOldDeliveries', () => {
    it('should delete old deliveries', async () => {
      (db.delete as ReturnType<typeof vi.fn>).mockReturnThis();
      (db.where as ReturnType<typeof vi.fn>).mockReturnThis();
      (db.returning as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }]);

      const count = await cleanupOldDeliveries(30);

      expect(count).toBe(2);
    });

    it('should return 0 when no old deliveries', async () => {
      (db.delete as ReturnType<typeof vi.fn>).mockReturnThis();
      (db.where as ReturnType<typeof vi.fn>).mockReturnThis();
      (db.returning as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const count = await cleanupOldDeliveries(30);

      expect(count).toBe(0);
    });

    it('should use custom days to keep', async () => {
      (db.delete as ReturnType<typeof vi.fn>).mockReturnThis();
      (db.where as ReturnType<typeof vi.fn>).mockReturnThis();
      (db.returning as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await cleanupOldDeliveries(7);

      expect(db.delete).toHaveBeenCalled();
    });
  });
});
