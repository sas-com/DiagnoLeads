/**
 * First meeting preferences of a consultation request (Refs #155): the dates a respondent may
 * choose, the input checks, and the texts sales and the respondent get; the topics and the note
 * of #244. Made-up names.
 * 2026-10-16 is a Friday.
 */
import {
  candidateDateRange,
  candidateLabelJa,
  candidatesInRange,
  duplicateCandidateOf,
  sortCandidates,
} from '@/lib/features/meeting-requests/candidates';
import {
  buildConfirmationEmail,
  buildPreferencesNotice,
} from '@/lib/features/meeting-requests/service';
import {
  MAX_TOPIC_NOTE_LENGTH,
  MEETING_TIMES,
  MEETING_TOPICS,
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

  it('points each option to an earlier one with the same date and time', () => {
    expect(
      duplicateCandidateOf([
        { date: '2026-10-20', time: '10:00' },
        { date: '2026-10-20', time: '10:00' },
        { date: '2026-10-20', time: '14:00' },
      ])
    ).toEqual([null, 1, null]);
    // Options without a date are not compared
    expect(
      duplicateCandidateOf([
        { date: '', time: '10:00' },
        { date: '', time: '10:00' },
        { date: '2026-10-21', time: '10:00' },
      ])
    ).toEqual([null, null, null]);
    expect(
      duplicateCandidateOf([
        { date: '2026-10-21', time: '10:00' },
        { date: '2026-10-20', time: '10:00' },
        { date: '2026-10-21', time: '10:00' },
      ])
    ).toEqual([null, null, 1]);
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
      topics: [],
      topicNote: null,
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

  it('takes known topics once each and a trimmed note up to 300 characters (#244)', () => {
    const one = { date: '2026-10-20', time: '10:00' };
    const parsed = parse({
      candidates: [one],
      topics: ['cost', 'schedule'],
      topicNote: '  基幹システムの移行時期を相談したい\n  ',
    });
    expect(parsed.success && parsed.data).toMatchObject({
      topics: ['cost', 'schedule'],
      topicNote: '基幹システムの移行時期を相談したい',
    });
    expect(parse({ candidates: [one], topics: [...MEETING_TOPICS] }).success).toBe(true);
    // Blank becomes null
    const blank = parse({ candidates: [one], topicNote: '   ' });
    expect(blank.success && blank.data.topicNote).toBeNull();
    // Exactly the limit, also with spaces around it
    const full = 'あ'.repeat(MAX_TOPIC_NOTE_LENGTH);
    expect(parse({ candidates: [one], topicNote: ` ${full} ` }).success).toBe(true);
  });

  it('refuses unknown or repeated topics and a note over 300 characters', () => {
    const one = { date: '2026-10-20', time: '10:00' };
    expect(parse({ candidates: [one], topics: ['pricing'] }).success).toBe(false);
    expect(parse({ candidates: [one], topics: ['cost', 'cost'] }).success).toBe(false);
    expect(parse({ candidates: [one], topics: 'cost' }).success).toBe(false);
    expect(
      parse({ candidates: [one], topicNote: 'あ'.repeat(MAX_TOPIC_NOTE_LENGTH + 1) }).success
    ).toBe(false);
    expect(parse({ candidates: [one], topicNote: 42 }).success).toBe(false);
  });

  it('refuses control and format characters in the note but keeps line breaks and tabs', () => {
    const one = { date: '2026-10-20', time: '10:00' };
    for (const bad of ['予算\u0000', '予算\u202e逆', 'a\u0001b', 'a\u200bb', 'a\ud800b']) {
      expect(parse({ candidates: [one], topicNote: bad }).success).toBe(false);
    }
    const kept = parse({ candidates: [one], topicNote: '一行目\r\n二行目\r三行目\t終わり' });
    expect(kept.success && kept.data.topicNote).toBe('一行目\n二行目\n三行目\t終わり');
    // A pair of surrogates (an emoji) is fine
    expect(parse({ candidates: [one], topicNote: '了解👍' }).success).toBe(true);
  });

  it('stores the topics in the order of the list, whatever order they came in', () => {
    const parsed = parse({
      candidates: [{ date: '2026-10-20', time: '10:00' }],
      topics: ['other', 'cost', 'result_detail'],
    });
    expect(parsed.success && parsed.data.topics).toEqual(['result_detail', 'cost', 'other']);
  });
});

describe('texts', () => {
  it('tells sales the options in order with the format', () => {
    const notice = buildPreferencesNotice({
      company: '架空商事',
      leadName: '山田 花子',
      identityVerified: true,
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
    expect(notice.message).not.toContain('相談したい内容');
  });

  it('tells sales the topics and the note, cut short in the notice (#244)', () => {
    const notice = buildPreferencesNotice({
      company: '架空商事',
      leadName: null,
      identityVerified: true,
      preferences: {
        candidates: [{ date: '2026-10-20', time: '14:00' }],
        meetingFormat: null,
        topics: ['cost', 'internal_resources'],
        topicNote: `移行の\n順番を${'あ'.repeat(150)}`,
      },
    });
    expect(notice.message).toContain('相談したい内容：費用の目安、社内の体制・人材の不足。');
    // Line breaks fold into one line; the note is cut at 100 characters
    expect(notice.message).toContain(`ご相談内容：「移行の 順番を${'あ'.repeat(93)}…」。`);
    expect(notice.message.endsWith('リードを開いて、候補から日程を確定してください。')).toBe(true);
  });

  it('marks the preferences of an unverified answer and asks sales to check first (#274)', () => {
    const input = {
      company: '架空商事',
      leadName: '山田 花子',
      preferences: {
        candidates: [{ date: '2026-10-20', time: '14:00' }],
        meetingFormat: 'online' as const,
      },
    };
    const verified = buildPreferencesNotice({ ...input, identityVerified: true });
    expect(verified).toEqual({
      title: '【希望日時】架空商事 山田 花子 様 から初回商談の希望日時が届きました',
      message:
        '希望：10月20日（火）14:00（オンライン）。リードを開いて、候補から日程を確定してください。',
    });
    const unverified = buildPreferencesNotice({ ...input, identityVerified: false });
    expect(unverified).toEqual({
      title: '【希望日時】（本人確認なし）架空商事 山田 花子 様 から初回商談の希望日時が届きました',
      message:
        '希望：10月20日（火）14:00（オンライン）。既存のリードとメールアドレスだけが一致した回答のため、確定する前にご本人に確認してください。リードを開いて、候補から日程を確定してください。',
    });
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
    // Signed by the organization
    expect(email.text).toContain('\n\n架空システムズ\n\n');
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
