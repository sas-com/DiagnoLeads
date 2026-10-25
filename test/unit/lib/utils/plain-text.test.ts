/**
 * PLAIN_TEXT (#546, #747): the one rule for single-line text shown to sales, read by the
 * diagnoses, the agency links and contracts, the appointment reviews and the prospects.
 */
import { contactSchema } from '@/lib/features/diagnostics/types/contact';
import { PLAIN_TEXT } from '@/lib/utils/plain-text';
import { describe, expect, it } from 'vitest';

describe('PLAIN_TEXT', () => {
  it('takes ordinary text, Japanese and emoji included', () => {
    for (const value of ['', '架空商事 株式会社', 'Acme Inc. (Tokyo)', '山田 太郎 👍']) {
      expect(PLAIN_TEXT.test(value)).toBe(true);
    }
  });

  it('lets the line and paragraph separators through: they are not control or format characters', () => {
    // Browsers show them as a space on one line and emails replace them with spaces
    // (lib/email/templates/render.ts), so they are left alone (#747)
    for (const value of ['a\u2028b', 'a\u2029b']) {
      expect(PLAIN_TEXT.test(value)).toBe(true);
    }
  });

  it('refuses line breaks, tabs, NUL and format characters such as a bidi override', () => {
    for (const value of ['a\nb', 'a\rb', 'a\tb', 'a\u0000b', 'a\u202Eb', 'a\u200Bb', 'a\uFEFFb']) {
      expect(PLAIN_TEXT.test(value)).toBe(false);
    }
  });

  it('refuses a lone surrogate, which jsonb cannot store, and keeps a pair (an emoji) (#747)', () => {
    for (const value of ['a\uD800b', 'a\uDC00b', '\uD83D']) {
      expect(PLAIN_TEXT.test(value)).toBe(false);
    }
    // A pair in the wrong order is two lone surrogates
    expect(PLAIN_TEXT.test('a\uDC4D\uD83Db')).toBe(false);
    expect(PLAIN_TEXT.test('a\uD83D\uDC4Db')).toBe(true);
    // A kanji outside the BMP (U+20BB7) is a pair too
    expect(PLAIN_TEXT.test('\uD842\uDFB7田')).toBe(true);
  });

  it('makes the public diagnosis form refuse a company name with a lone surrogate (#747)', () => {
    const contact = { company: '架空商事', name: '試験 太郎', email: 'taro@example.co.jp' };
    expect(contactSchema.safeParse(contact).success).toBe(true);
    expect(contactSchema.safeParse({ ...contact, company: '架空\uD800商事' }).success).toBe(false);
  });
});
