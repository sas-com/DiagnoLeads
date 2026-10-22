import type { HearingFields } from '@/lib/features/lead-hearings/types/schemas';
import { type ProspectForPrefill, referralHearingFields } from '@/lib/features/prospects/hearing-prefill';
import { describe, expect, it } from 'vitest';

const row = (values: Partial<ProspectForPrefill> = {}): ProspectForPrefill => ({
  contactedOn: '2026-10-21',
  recorder: '山田',
  department: null,
  jobTitle: null,
  surname: '佐藤',
  targetSystem: 'as400',
  supportEndSoon: 'yes',
  troubles: ['no_documents'],
  heard: '保守担当が1名',
  ...values,
});

describe('referralHearingFields', () => {
  it('fills the system and a note in 課題のメモ, marked as the employee record', () => {
    const fields = referralHearingFields([row()], {});
    expect(fields.targetSystem).toEqual({ value: 'as400', status: 'not_yet', source: 'referral' });
    expect(fields.challengeNotes?.source).toBe('referral');
    expect(fields.challengeNotes?.value).toContain('聞いた話: 保守担当が1名');
    expect(fields.challengeNotes?.value).toContain('保守期限: 1年以内');
  });

  it('leaves what the diagnosis or the agency already filled', () => {
    const existing = {
      targetSystem: { value: 'acos', status: 'not_yet', source: 'prefilled' },
      challengeNotes: { value: '代行が聞いた話', status: 'not_yet', source: 'agency' },
    } as HearingFields;
    expect(referralHearingFields([row()], existing)).toEqual(existing);
  });

  it('takes the latest system named, notes every row, and keeps within 1000 characters', () => {
    const fields = referralHearingFields(
      [
        row({ targetSystem: 'access', recorder: '鈴木' }),
        row({ targetSystem: null, heard: 'あ'.repeat(1200) }),
      ],
      {}
    );
    expect(fields.targetSystem?.value).toBe('access');
    const note = String(fields.challengeNotes?.value);
    expect(note.startsWith('顧客探しの記録（2026-10-21、鈴木）')).toBe(true);
    expect(Array.from(note)).toHaveLength(1000);
  });

  it('changes nothing without rows', () => {
    expect(referralHearingFields([], {})).toEqual({});
  });
});
