import { safeCallbackPath } from '@/lib/auth/safe-callback';
import { describe, expect, it } from 'vitest';

describe('safeCallbackPath', () => {
  it('follows paths on this site', () => {
    expect(safeCallbackPath('/ja/invite/abc')).toBe('/ja/invite/abc');
    expect(safeCallbackPath('/leads?leadId=1')).toBe('/leads?leadId=1');
  });

  it('falls back for missing values and other sites', () => {
    expect(safeCallbackPath(null)).toBe('/dashboard');
    expect(safeCallbackPath('')).toBe('/dashboard');
    expect(safeCallbackPath('https://evil.example')).toBe('/dashboard');
    expect(safeCallbackPath('//evil.example')).toBe('/dashboard');
    expect(safeCallbackPath('/\\evil.example')).toBe('/dashboard');
    expect(safeCallbackPath('javascript:alert(1)', '/home')).toBe('/home');
  });
});
