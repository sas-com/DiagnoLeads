/**
 * Webhook custom headers (#314): readers get the names only, and an update keeps a stored value
 * unless a new one is given. All values are made up.
 */
import {
  WEBHOOK_HEADER_MASK,
  maskWebhookHeaders,
  mergeWebhookHeaders,
} from '@/lib/features/webhooks/services/webhook-headers';
import { describe, expect, it } from 'vitest';

const stored = { Authorization: 'Bearer made-up-token-314', 'X-Tenant': 'tenant-made-up' };

describe('maskWebhookHeaders', () => {
  it('returns the names only', () => {
    const masked = maskWebhookHeaders(stored);
    expect(masked).toEqual([
      { name: 'Authorization', masked: true },
      { name: 'X-Tenant', masked: true },
    ]);
    expect(JSON.stringify(masked)).not.toContain('made-up');
  });

  it('handles no headers', () => {
    expect(maskWebhookHeaders(null)).toEqual([]);
    expect(maskWebhookHeaders(undefined)).toEqual([]);
    expect(maskWebhookHeaders({})).toEqual([]);
  });
});

describe('mergeWebhookHeaders', () => {
  it('keeps a stored value when the header comes without a value or with the mask', () => {
    expect(
      mergeWebhookHeaders(stored, [
        { name: 'Authorization' },
        { name: 'X-Tenant', value: WEBHOOK_HEADER_MASK },
      ])
    ).toEqual({ ok: true, headers: stored });
  });

  it('replaces a value, adds a new header and removes the ones left out', () => {
    expect(
      mergeWebhookHeaders(stored, [
        { name: 'Authorization', value: 'Bearer another-made-up-token' },
        { name: 'X-Trace', value: 'trace-made-up' },
      ])
    ).toEqual({
      ok: true,
      headers: { Authorization: 'Bearer another-made-up-token', 'X-Trace': 'trace-made-up' },
    });
  });

  it('removes every header with an empty list', () => {
    expect(mergeWebhookHeaders(stored, [])).toEqual({ ok: true, headers: {} });
  });

  it('refuses a new header without a value', () => {
    expect(mergeWebhookHeaders(stored, [{ name: 'X-New' }])).toEqual({
      ok: false,
      reason: 'missing_value',
      name: 'X-New',
    });
    expect(mergeWebhookHeaders(null, [{ name: 'X-New', value: WEBHOOK_HEADER_MASK }])).toEqual({
      ok: false,
      reason: 'missing_value',
      name: 'X-New',
    });
  });

  it('matches names exactly', () => {
    expect(mergeWebhookHeaders(stored, [{ name: 'authorization' }])).toMatchObject({
      ok: false,
      reason: 'missing_value',
    });
  });

  it('refuses a name given twice', () => {
    expect(
      mergeWebhookHeaders(stored, [
        { name: 'X-Tenant' },
        { name: 'X-Tenant', value: 'tenant-other' },
      ])
    ).toEqual({ ok: false, reason: 'duplicate_name', name: 'X-Tenant' });
  });
});
