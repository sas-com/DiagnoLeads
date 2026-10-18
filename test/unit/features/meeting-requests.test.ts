/**
 * First meeting preferences of a consultation request (Refs #155): the dates a respondent may
 * choose, the input checks, and the texts sales and the respondent get. Made-up names.
 * 2026-10-16 is a Friday.
 */
import {
  candidateDateRange,
  candidateLabelJa,
  candidatesInRange,
  sortCandidates,
} from '@/lib/features/meeting-requests/candidates';
import {
  buildConfirmationEmail,
  buildPreferencesNotice,
} from '@/lib/features/meeting-requests/service';
import {
  MEETING_TIMES,
  meetingPreferencesSchema,
} from '@/lib/features/meeting-requests/types/schemas';
import { describe, expect, it } from 'vitest';

describe('candidate dates', () => {
  it('runs from tomorrow up to 60 days ahead', () => {
    expect(candidateDateRange('2026-10-16')).toEqual({ min: '2026-10-17', max: '2026-12-15' });
    expect(candidatesInRange([{ date: '2026-10-17', time: '10:00' }], '2026-10-16')).toBe(true);
    expect(candidatesInRange([{ date: '2026-10-16', time: '10:00' }], '2026-10-16')).toBe(false);
    expect(candidatesInRange([{ date: '2026-12-16', time: '10:00' }], '2026-10-16')).toBe(false);
  });

  it('sorts the earliest first and labels them in Japanese', () => {
    expect(
      sortCandidates([
        { date: '2026-10-21', time: '10:00' },
        { date: '2026-10-20', time: '15:30' },
        { date: '2026-10-20', time: '09:00' },
      ])
    ).toEqual([
      { date: '2026-10-20', time: '09:00' },
      { date: '2026-10-20', time: '15:30' },
      { date: '2026-10-21', time: '10:00' },
    ]);
    expect(candidateLabelJa({ date: '2026-10-20', time: '14:00' })).toBe('10月20日（火）14:00');
  });

  it('offers start times from 09:00 to 18:00 every 30 minutes', () => {
    expect(MEETING_TIMES[0]).toBe('09:00');
    expect(MEETING_TIMES.at(-1)).toBe('18:00');
    expect(MEETING_TIMES).toHaveLength(19);
  });
});

describe('meetingPreferencesSchema', () => {
  const parse = (value: unknown) => meetingPreferencesSchema.safeParse(value);

  it('takes one to three distinct candidates, roles once each and the format', () => {
    const parsed = parse({
      candidates: [{ date: '2026-10-20', time: '10:00' }],
      attendeeRoles: ['executive', 'it_staff', 'executive'],
      meetingFormat: 'online',
    });
    expect(parsed.success && parsed.data).toEqual({
      candidates: [{ date: '2026-10-20', time: '10:00' }],
      attendeeRoles: ['executive', 'it_staff'],
      meetingFormat: 'online',
    });
    expect(parse({ candidates: [{ date: '2026-10-20', time: '10:00' }] }).success).toBe(true);
  });

  it('refuses no candidate, four, duplicates, odd times, unknown roles and formats', () => {
    const one = { date: '2026-10-20', time: '10:00' };
    expect(parse({ candidates: [] }).success).toBe(false);
    expect(
      parse({
        candidates: ['10:00', '10:30', '11:00', '11:30'].map((time) => ({ date: '2026-10-20', time })),
      }).success
    ).toBe(false);
    expect(parse({ candidates: [one, one] }).success).toBe(false);
    expect(parse({ candidates: [{ date: '2026-10-20', time: '10:15' }] }).success).toBe(false);
    expect(parse({ candidates: [{ date: '2026-02-30', time: '10:00' }] }).success).toBe(false);
    expect(parse({ candidates: [one], attendeeRoles: ['ceo'] }).success).toBe(false);
    expect(parse({ candidates: [one], meetingFormat: 'phone' }).success).toBe(false);
  });
});

describe('texts', () => {
  it('tells sales the options in order with the format', () => {
    const notice = buildPreferencesNotice({
      company: '架空商事',
      leadName: '山田 花子',
      preferences: {
        candidates: [
          { date: '2026-10-21', time: '10:00' },
          { date: '2026-10-20', time: '14:00' },
        ],
        meetingFormat: 'onsite',
      },
    });
    expect(notice.title).toBe('【希望日時】架空商事 山田 花子 様 から初回商談の希望日時が届きました');
    expect(notice.message).toContain('10月20日（火）14:00、10月21日（水）10:00（訪問）');
  });

  it('writes the confirmation with the date, the format and who is in charge', () => {
    const email = buildConfirmationEmail({
      organizationName: '架空システムズ',
      company: '架空商事',
      leadName: '山田 花子',
      candidate: { date: '2026-10-20', time: '14:00' },
      meetingFormat: 'online',
      confirmedByName: '営業 太郎',
    });
    expect(email.subject).toBe('【日程のご連絡】初回のご相談：10月20日（火）14:00〜');
    expect(email.text).toContain('日時：10月20日（火）14:00〜（日本時間）');
    expect(email.text).toContain('形式：オンライン（接続先は別途お送りします）');
    expect(email.text).toContain('担当：営業 太郎');
    expect(email.text.trim().endsWith('架空システムズ')).toBe(true);
    // Names are escaped in the HTML part
    expect(
      buildConfirmationEmail({
        organizationName: '<b>x</b>',
        company: null,
        leadName: null,
        candidate: { date: '2026-10-20', time: '14:00' },
        meetingFormat: null,
        confirmedByName: null,
      }).html
    ).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
