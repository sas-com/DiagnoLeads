import {
  allowedEmailDomains,
  filterAllowedRecipients,
  isAllowedEmail,
  isTestMode,
  testModeEmailMessage,
} from '@/lib/email/allowed-recipients';
import { describe, expect, it, vi } from 'vitest';

describe('test mode email restriction', () => {
  it('is off unless APP_TEST_MODE is "true"', () => {
    expect(isTestMode(undefined)).toBe(false);
    expect(isTestMode('')).toBe(false);
    expect(isTestMode('false')).toBe(false);
    expect(isTestMode('1')).toBe(false);
    expect(isTestMode('true')).toBe(true);
    expect(isTestMode(' TRUE ')).toBe(true);
  });

  it('allows everything when off, and sas-com.com by default when on', () => {
    expect(allowedEmailDomains(false, 'sas-com.com')).toEqual([]);
    expect(allowedEmailDomains(true, undefined)).toEqual(['sas-com.com']);
    expect(allowedEmailDomains(true, ' @Sas-Com.com , example.jp ')).toEqual(['sas-com.com', 'example.jp']);
  });

  it('matches the exact domain of plain and named addresses', () => {
    const domains = ['sas-com.com'];
    expect(isAllowedEmail('Tokumoto@SAS-COM.com', domains)).toBe(true);
    expect(isAllowedEmail('営業 <sales@sas-com.com>', domains)).toBe(true);
    expect(isAllowedEmail('someone@gmail.com', domains)).toBe(false);
    expect(isAllowedEmail('x@evil-sas-com.com', domains)).toBe(false);
    expect(isAllowedEmail('x@sas-com.com.evil.example', domains)).toBe(false);
    // The last <...> is where the mail goes, whatever the display name says
    expect(isAllowedEmail('"x <a@sas-com.com>" <b@gmail.com>', domains)).toBe(false);
    expect(isAllowedEmail('"x <b@gmail.com>" <a@sas-com.com>', domains)).toBe(true);
    expect(isAllowedEmail('anyone@gmail.com', [])).toBe(true);
  });

  it('drops recipients outside the domains and reports how many', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      filterAllowedRecipients(['a@sas-com.com', 'b@gmail.com', 'c@sas-com.com'], ['sas-com.com'])
    ).toEqual(['a@sas-com.com', 'c@sas-com.com']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('1 recipient(s)'));
    expect(filterAllowedRecipients(undefined, ['sas-com.com'])).toEqual([]);
    expect(filterAllowedRecipients('b@gmail.com', [])).toEqual(['b@gmail.com']);
  });

  it('names the allowed domains in the validation message', () => {
    expect(testModeEmailMessage(['sas-com.com'])).toBe(
      'テスト中のため、@sas-com.com のメールアドレスのみ登録できます'
    );
  });
});
