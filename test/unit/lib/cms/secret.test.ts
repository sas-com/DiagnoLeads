/**
 * PAYLOAD_SECRET has no default, and the CMS refuses weak or example values (#413)
 */
import { payloadSecret } from '@/lib/cms/secret';
import { afterEach, describe, expect, it, vi } from 'vitest';

const STRONG = 'q8Jx3vT0mW5rZk2NcY7bLp4Hf9Gd1Sa6'; // 32 characters

describe('payloadSecret', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns a configured secret of at least 32 characters', () => {
    vi.stubEnv('CMS_ENABLED', 'true');
    vi.stubEnv('PAYLOAD_SECRET', STRONG);
    expect(payloadSecret()).toBe(STRONG);
  });

  it('throws when the CMS is on and the secret is missing or blank', () => {
    vi.stubEnv('CMS_ENABLED', 'true');
    for (const value of ['', '   ', undefined]) {
      vi.stubEnv('PAYLOAD_SECRET', value);
      expect(() => payloadSecret()).toThrow('PAYLOAD_SECRET is not set');
    }
  });

  it('throws when the CMS is on and the secret is shorter than 32 characters', () => {
    vi.stubEnv('CMS_ENABLED', 'true');
    vi.stubEnv('PAYLOAD_SECRET', STRONG.slice(0, 31));
    expect(() => payloadSecret()).toThrow('too short');
  });

  it('throws when the CMS is on and the secret is an example value', () => {
    vi.stubEnv('CMS_ENABLED', 'true');
    for (const value of [
      'your-payload-secret-here-change-in-production',
      'generate-secure-payload-secret',
      'your-secret-key-change-in-production',
    ]) {
      vi.stubEnv('PAYLOAD_SECRET', value);
      expect(() => payloadSecret()).toThrow('example value');
    }
  });

  it('never throws nor falls back to a built-in key while the CMS is off', () => {
    // Builds run without the secret: an empty key, which Payload refuses to start with
    vi.stubEnv('CMS_ENABLED', 'false');
    vi.stubEnv('PAYLOAD_SECRET', '');
    expect(payloadSecret()).toBe('');
    vi.stubEnv('PAYLOAD_SECRET', 'short');
    expect(payloadSecret()).toBe('short');
  });
});
