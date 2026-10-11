/**
 * Content Security Policy: the guarantees the production policy must keep.
 * A change that weakens one of them has to change this test too.
 */
import { contentSecurityPolicy } from '@/lib/middleware/csp';
import { describe, expect, it } from 'vitest';

/** Directive name -> its sources */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...sources] = part.split(/\s+/);
        return [name, sources] as const;
      })
  );
}

describe('contentSecurityPolicy (production)', () => {
  const policy = directives(contentSecurityPolicy('abc123', false));

  it('runs only scripts with the request nonce (and the scripts they add)', () => {
    expect(policy.get('script-src')).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
  });

  it('allows <style> elements only with the nonce', () => {
    expect(policy.get('style-src')).toEqual(["'self'", "'nonce-abc123'"]);
  });

  it('allows inline style attributes, and nothing else, through style-src-attr', () => {
    expect(policy.get('style-src-attr')).toEqual(["'unsafe-inline'"]);
    // Inline event handlers fall back to script-src, so they stay blocked
    expect(policy.has('script-src-attr')).toBe(false);
  });

  it('allows frames only from Cloudflare Turnstile', () => {
    expect(policy.get('frame-src')).toEqual(['https://challenges.cloudflare.com']);
  });

  it('keeps plugins, framing by other sites and foreign form targets out', () => {
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    expect(policy.get('form-action')).toEqual(["'self'"]);
    expect(policy.get('base-uri')).toEqual(["'self'"]);
    expect(policy.get('default-src')).toEqual(["'self'"]);
  });

  it('is one line', () => {
    expect(contentSecurityPolicy('abc123', false)).not.toMatch(/\n/);
  });
});

describe('contentSecurityPolicy (development)', () => {
  it('allows the Turnstile frame there too, so the check can be tried locally', () => {
    const policy = directives(contentSecurityPolicy('abc123', true));
    expect(policy.get('frame-src')).toEqual(['https://challenges.cloudflare.com']);
  });
});
