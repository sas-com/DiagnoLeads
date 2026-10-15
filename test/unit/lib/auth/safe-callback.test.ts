import { safeCallbackPath } from '@/lib/auth/safe-callback';
import { describe, expect, it } from 'vitest';

describe('safeCallbackPath', () => {
  it('follows paths on this site', () => {
    expect(safeCallbackPath('/ja/invite/abc')).toBe('/ja/invite/abc');
    expect(safeCallbackPath('/leads?leadId=1#top')).toBe('/leads?leadId=1#top');
  });

  it('falls back for missing values and other sites', () => {
    expect(safeCallbackPath(null)).toBe('/dashboard');
    expect(safeCallbackPath('')).toBe('/dashboard');
    expect(safeCallbackPath('https://evil.example')).toBe('/dashboard');
    expect(safeCallbackPath('//evil.example')).toBe('/dashboard');
    expect(safeCallbackPath('/\\evil.example')).toBe('/dashboard');
    expect(safeCallbackPath('javascript:alert(1)', '/home')).toBe('/home');
  });

  it('is not fooled by tabs, line breaks or backslashes the browser drops or rewrites', () => {
    for (const value of ['/\t/evil.example', '/\n/evil.example', '/\t\\evil.example', '/\r\n//evil.example']) {
      const result = safeCallbackPath(value);
      expect(result).toBe('/dashboard');
      expect(new URL(result, 'https://app.example').origin).toBe('https://app.example');
    }
  });
});
