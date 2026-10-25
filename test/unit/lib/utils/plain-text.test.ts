/**
 * PLAIN_TEXT (#546): the one rule for single-line text shown to sales, read by the diagnoses,
 * the agency links and contracts, the appointment reviews and the prospects.
 */
import { PLAIN_TEXT } from '@/lib/utils/plain-text';
import { describe, expect, it } from 'vitest';

describe('PLAIN_TEXT', () => {
  it('takes ordinary text, Japanese and emoji included', () => {
    for (const value of ['', '架空商事 株式会社', 'Acme Inc. (Tokyo)', '山田 太郎 👍']) {
      expect(PLAIN_TEXT.test(value)).toBe(true);
    }
  });

  it('lets the line and paragraph separators through: they are not control or format characters', () => {
    // Emails replace them with spaces (lib/email/templates/render.ts); this pins today's rule
    for (const value of ['a\u2028b', 'a\u2029b']) {
      expect(PLAIN_TEXT.test(value)).toBe(true);
    }
  });

  it('refuses line breaks, tabs, NUL and format characters such as a bidi override', () => {
    for (const value of ['a\nb', 'a\rb', 'a\tb', 'a\u0000b', 'a\u202Eb', 'a\u200Bb', 'a\uFEFFb']) {
      expect(PLAIN_TEXT.test(value)).toBe(false);
    }
  });
});
