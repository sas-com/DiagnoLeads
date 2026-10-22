/**
 * Webhook custom headers (#314): readers get the names only, and an update keeps a stored value
 * unless a new one is given. All values are made up.
 */
import {
  WEBHOOK_HEADER_MASK,
  buildWebhookHeaders,
  isUrlChanged,
  isReservedWebhookHeaderName,
  isValidWebhookHeaderName,
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

  it('matches names without regard to case: a rename of the case keeps the value', () => {
    expect(mergeWebhookHeaders(stored, [{ name: 'authorization' }, { name: 'x-tenant' }])).toEqual({
      ok: true,
      headers: { authorization: 'Bearer made-up-token-314', 'x-tenant': 'tenant-made-up' },
    });
  });

  it('refuses a name given twice, in any case', () => {
    expect(
      mergeWebhookHeaders(stored, [
        { name: 'X-Tenant' },
        { name: 'X-Tenant', value: 'tenant-other' },
      ])
    ).toEqual({ ok: false, reason: 'duplicate_name', name: 'X-Tenant' });
    expect(
      mergeWebhookHeaders(stored, [
        { name: 'X-Tenant', value: 'a' },
        { name: 'x-TENANT', value: 'b' },
      ])
    ).toEqual({ ok: false, reason: 'duplicate_name', name: 'x-TENANT' });
  });

  describe('when the origin changes (requireNewValues)', () => {
    it('refuses to keep a stored value, missing or masked', () => {
      for (const kept of [{ name: 'Authorization' }, { name: 'authorization', value: WEBHOOK_HEADER_MASK }]) {
        expect(
          mergeWebhookHeaders(stored, [kept, { name: 'X-Tenant', value: 'new' }], {
            requireNewValues: true,
          })
        ).toMatchObject({ ok: false, reason: 'headers_reentry_required' });
      }
    });

    it('accepts every value entered again, or the headers removed', () => {
      expect(
        mergeWebhookHeaders(stored, [{ name: 'Authorization', value: 'Bearer made-up-new' }], {
          requireNewValues: true,
        })
      ).toEqual({ ok: true, headers: { Authorization: 'Bearer made-up-new' } });
      expect(mergeWebhookHeaders(stored, [], { requireNewValues: true })).toEqual({
        ok: true,
        headers: {},
      });
    });
  });

  it('keeps a __proto__ name as an ordinary header (N2)', () => {
    // jsonb comes back through JSON.parse, which makes __proto__ an own key
    const fromJson = JSON.parse('{"__proto__":"made-up-proto"}') as Record<string, string>;
    const merged = mergeWebhookHeaders(fromJson, [
      { name: '__proto__' },
      { name: 'constructor', value: 'c' },
    ]);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(Object.keys(merged.headers)).toEqual(['__proto__', 'constructor']);
    expect(JSON.stringify(merged.headers)).toBe('{"__proto__":"made-up-proto","constructor":"c"}');
  });
});

describe('buildWebhookHeaders', () => {
  it('builds the map from the list, keeping __proto__ as a key', () => {
    const result = buildWebhookHeaders([
      { name: '__proto__', value: 'p' },
      { name: 'X-Tenant', value: 't' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.headers)).toEqual(['__proto__', 'X-Tenant']);
    expect(JSON.stringify(result.headers)).toBe('{"__proto__":"p","X-Tenant":"t"}');
  });

  it('refuses a name given twice, in any case', () => {
    expect(
      buildWebhookHeaders([
        { name: 'Authorization', value: 'a' },
        { name: 'AUTHORIZATION', value: 'b' },
      ])
    ).toEqual({ ok: false, reason: 'duplicate_name', name: 'AUTHORIZATION' });
  });
});

describe('header names', () => {
  it('reserves the names the delivery sets or the client controls, in any case', () => {
    for (const name of [
      'Content-Type',
      'user-agent',
      'HOST',
      'Content-Length',
      'Transfer-Encoding',
      'Connection',
      'X-Webhook-Signature',
      'X-Webhook-ID',
      'x-webhook-event',
      'X-Webhook-Future',
    ]) {
      expect(isReservedWebhookHeaderName(name)).toBe(true);
      expect(isValidWebhookHeaderName(name)).toBe(false);
    }
    expect(isReservedWebhookHeaderName('Authorization')).toBe(false);
    expect(isReservedWebhookHeaderName('X-Webhooks')).toBe(false);
  });

  it('accepts tokens only', () => {
    expect(isValidWebhookHeaderName('Authorization')).toBe(true);
    expect(isValidWebhookHeaderName('a'.repeat(100))).toBe(true);
    expect(isValidWebhookHeaderName('a'.repeat(101))).toBe(false);
    expect(isValidWebhookHeaderName(' X')).toBe(false);
    expect(isValidWebhookHeaderName('X:Y')).toBe(false);
    expect(isValidWebhookHeaderName('')).toBe(false);
  });
});

describe('isUrlChanged', () => {
  it('ignores what new URL() normalises', () => {
    expect(isUrlChanged('https://a.example.com/x', 'https://a.example.com/x')).toBe(false);
    expect(isUrlChanged('https://a.example.com/x', 'https://A.Example.COM:443/x')).toBe(false);
    expect(isUrlChanged('HTTPS://a.example.com', 'https://a.example.com/')).toBe(false);
  });

  it('counts any other change: scheme, host, port, path or query', () => {
    const before = 'https://hooks.example.com/u/team-a';
    for (const after of [
      'http://hooks.example.com/u/team-a',
      'https://other.example.com/u/team-a',
      'https://hooks.example.com:8443/u/team-a',
      'https://hooks.example.com/u/team-b',
      'https://hooks.example.com/u/team-a?x=1',
      'not a url',
    ]) {
      expect(isUrlChanged(before, after)).toBe(true);
    }
  });
});
