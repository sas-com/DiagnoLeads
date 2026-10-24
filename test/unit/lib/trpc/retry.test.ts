import { retryUnlessDenied } from '@/lib/trpc/retry';
import { describe, expect, it } from 'vitest';

describe('retry of failed requests', () => {
  const retry = retryUnlessDenied(2);

  it('retries other failures up to the limit', () => {
    expect(retry(0, new Error('network'))).toBe(true);
    expect(retry(1, { data: { code: 'INTERNAL_SERVER_ERROR' } })).toBe(true);
    expect(retry(2, new Error('network'))).toBe(false);
  });

  it('never retries when signed out or not allowed', () => {
    expect(retry(0, { data: { code: 'UNAUTHORIZED' } })).toBe(false);
    expect(retry(0, { data: { code: 'FORBIDDEN' } })).toBe(false);
  });

  it('never retries a request refused by a rate limit (it would count again)', () => {
    expect(retry(0, { data: { code: 'TOO_MANY_REQUESTS' } })).toBe(false);
  });
});
