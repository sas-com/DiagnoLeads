/**
 * The expiry of a QR campaign as the settings page sets it (#695): a day entered is meant in
 * Japan and stored as the end of that day there, so the /q/ entry (isCampaignOpen) answers scans
 * through that day and refuses them from midnight on. The date input is filled back with the
 * last day the campaign is open.
 */
import {
  expiryOfJstDay,
  jstDayOf,
  lastOpenJstDayOf,
} from '@/lib/features/distribution/campaign-expiry';
import { isCampaignOpen } from '@/lib/features/distribution/short-code-entry';
import { createQRCampaignSchema } from '@/lib/features/distribution/types';
import { describe, expect, it } from 'vitest';

describe('expiryOfJstDay', () => {
  it('is the end of the day in Japan, in UTC', () => {
    expect(expiryOfJstDay('2026-10-31')).toBe('2026-10-31T14:59:59.999Z');
    expect(expiryOfJstDay('2027-01-01')).toBe('2027-01-01T14:59:59.999Z');
    expect(expiryOfJstDay('2028-02-29')).toBe('2028-02-29T14:59:59.999Z');
  });

  it('is what the API takes as an expiry', () => {
    const expiresAt = expiryOfJstDay('2026-10-31');
    const input = { name: 'Fair', diagnosticTemplateId: crypto.randomUUID(), expiresAt };
    expect(createQRCampaignSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    '',
    '2026-02-30',
    '2027-02-29',
    '2026-13-01',
    '2026-10-32',
    '2026/10/31',
    '2026-10-31T00:00',
    '26-10-31',
  ])('refuses %j, which is not a day of the calendar', (day) => {
    expect(expiryOfJstDay(day)).toBeNull();
  });

  it('keeps the campaign open through the day in Japan and closes it at midnight there', () => {
    const expiresAt = new Date(expiryOfJstDay('2026-10-31') as string);
    const campaign = { isActive: true, expiresAt };
    expect(isCampaignOpen(campaign, new Date('2026-10-31T23:59:59.998+09:00'))).toBe(true);
    expect(isCampaignOpen(campaign, new Date('2026-11-01T00:00:00.000+09:00'))).toBe(false);
  });
});

describe('lastOpenJstDayOf', () => {
  it('gives back the day that was entered', () => {
    for (const day of ['2026-10-31', '2026-12-31', '2028-02-29']) {
      expect(lastOpenJstDayOf(new Date(expiryOfJstDay(day) as string))).toBe(day);
    }
  });

  it('gives the day before for an expiry at midnight in Japan, the last day it was open', () => {
    expect(lastOpenJstDayOf(new Date('2026-12-31T15:00:00.000Z'))).toBe('2026-12-31');
  });

  it('gives the day of an expiry within a day', () => {
    expect(lastOpenJstDayOf(new Date('2026-10-31T03:00:00.000Z'))).toBe('2026-10-31');
  });
});

describe('jstDayOf', () => {
  it('is the day in Japan, not in UTC', () => {
    expect(jstDayOf(new Date('2026-10-31T15:00:00.000Z'))).toBe('2026-11-01');
    expect(jstDayOf(new Date('2026-10-31T14:59:59.999Z'))).toBe('2026-10-31');
  });
});
