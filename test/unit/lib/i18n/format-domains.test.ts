import { formatEmailDomains } from '@/lib/i18n/format-domains';
import { describe, expect, it } from 'vitest';

describe('formatEmailDomains', () => {
  it('lists the domains in the reader language', () => {
    expect(formatEmailDomains(['a.co.jp', 'b.co.jp'], 'ja')).toBe('@a.co.jp、@b.co.jp');
    expect(formatEmailDomains(['a.co.jp', 'b.co.jp'], 'en')).toBe('@a.co.jp and @b.co.jp');
    expect(formatEmailDomains(['a.co.jp'], 'en')).toBe('@a.co.jp');
  });
});
