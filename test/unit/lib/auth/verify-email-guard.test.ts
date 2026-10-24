import {
  VERIFY_IN_SIGNED_IN_BROWSER,
  refusedVerificationRedirect,
  verificationTokenEmail,
} from '@/lib/auth/verify-email-guard';
import { describe, expect, it } from 'vitest';

const tokenFor = (payload: unknown) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

describe('verificationTokenEmail', () => {
  it('reads the address of a verification token, lower-cased', () => {
    expect(verificationTokenEmail(tokenFor({ email: 'New@Example.com', exp: 1 }))).toBe(
      'new@example.com'
    );
  });

  it.each([
    ['no token', undefined],
    ['not a string', 42],
    ['not a JWT', 'bad'],
    ['broken payload', 'a.%%%.c'],
    ['no address', tokenFor({ sub: 'x' })],
    ['payload null', tokenFor(null)],
  ])('gives null for %s', (_, token) => {
    expect(verificationTokenEmail(token)).toBeNull();
  });
});

describe('refusedVerificationRedirect', () => {
  it('sends a path on this site back with the error code', () => {
    expect(refusedVerificationRedirect('/ja/invite/abc')).toBe(
      `/ja/invite/abc?error=${VERIFY_IN_SIGNED_IN_BROWSER}`
    );
    expect(refusedVerificationRedirect('/ja/invite/abc?x=1')).toBe(
      `/ja/invite/abc?x=1&error=${VERIFY_IN_SIGNED_IN_BROWSER}`
    );
  });

  it.each([
    ['another site', 'https://evil.example/'],
    ['a protocol-relative URL', '//evil.example/'],
    ['a backslash trick', '/\\evil.example/'],
    ['nothing', undefined],
    ['a relative path without a slash', 'ja/invite'],
  ])('refuses %s', (_, url) => {
    expect(refusedVerificationRedirect(url)).toBeNull();
  });
});
