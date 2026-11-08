/**
 * inferInflowSource looks utm_medium up only among the media its table names (#804). The visitor
 * writes utm_medium in the address, and a plain object also answers the names of
 * Object.prototype: `constructor` put a function in the lead's inflow source and `__proto__`
 * failed the save of the answer. The other cases of inferInflowSource are in
 * diagnostics-engine.test.ts.
 */
import { inferInflowSource } from '@/lib/features/diagnostics/tracking';
import { describe, expect, it } from 'vitest';

describe('inferInflowSource with a utm_medium outside its table (#804)', () => {
  it.each([
    'constructor',
    '__proto__',
    'hasownproperty',
    'tostring',
    'toString',
    'hasOwnProperty',
    'valueOf',
    'isPrototypeOf',
    '__defineGetter__',
    ' Constructor ',
    '__PROTO__',
  ])('leaves utm_medium=%j without an inflow source, like an unknown medium', (utmMedium) => {
    expect(inferInflowSource({ utmMedium })).toEqual({
      inflowSource: null,
      referrerName: null,
      agencyName: null,
    });
  });

  it('keeps a referral code as 紹介・パートナー with such a medium, as with any unknown medium', () => {
    expect(inferInflowSource({ ref: 'p', utmMedium: 'constructor' })).toEqual(
      inferInflowSource({ ref: 'p', utmMedium: 'email' })
    );
  });

  // Every mapping of the table, unchanged by #804
  it.each([
    ['cpc', 'advertising'],
    ['ppc', 'advertising'],
    ['paid', 'advertising'],
    ['paid_search', 'advertising'],
    ['paid_social', 'advertising'],
    ['display', 'advertising'],
    ['ads', 'advertising'],
    ['retargeting', 'advertising'],
    ['seminar', 'seminar'],
    ['webinar', 'seminar'],
    ['event', 'seminar'],
    ['exhibition', 'seminar'],
    ['direct_mail', 'advertising'],
    ['referral', 'referral_partner'],
    ['partner', 'referral_partner'],
    ['customer', 'existing_customer'],
    ['existing_customer', 'existing_customer'],
    ['executive', 'executive_network'],
    ['organic', 'lp_organic'],
    ['telemarketing', 'telemarketing_agency'],
    ['teleapo', 'telemarketing_agency'],
    ['outbound_call', 'telemarketing_agency'],
    ['referral_agency', 'referral_agency'],
  ])('still maps utm_medium=%s to %s', (utmMedium, inflowSource) => {
    expect(inferInflowSource({ utmMedium }).inflowSource).toBe(inflowSource);
    expect(inferInflowSource({ utmMedium: ` ${utmMedium.toUpperCase()} ` }).inflowSource).toBe(
      inflowSource
    );
  });
});
