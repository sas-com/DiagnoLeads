import { leadNoteFromProspect, normalizeCompany, sameCompany } from '@/lib/features/prospects/lead-link';
import { describe, expect, it } from 'vitest';

describe('sameCompany', () => {
  it('ignores the legal form, width, case and spaces', () => {
    expect(normalizeCompany('株式会社 サンプル製作所')).toBe('サンプル製作所');
    expect(sameCompany('株式会社サンプル製作所', 'ｻﾝﾌﾟﾙ製作所')).toBe(true);
    expect(sameCompany('(株)ABC Systems', 'abc systems 株式会社')).toBe(true);
    expect(sameCompany('サンプル製作所', 'サンプル製作所 東京工場')).toBe(true);
  });

  it('does not match short or unrelated names', () => {
    expect(sameCompany('AB', 'ABC商事')).toBe(false);
    expect(sameCompany('架空工業', '架空商事')).toBe(false);
    expect(sameCompany('株式会社', '株式会社')).toBe(false);
  });
});

describe('leadNoteFromProspect', () => {
  it('writes what was heard in the order sales read it, leaving out what is empty', () => {
    expect(
      leadNoteFromProspect({
        contactedOn: '2026-10-21',
        recorder: '山田',
        department: '情報システム部',
        jobTitle: null,
        surname: '佐藤',
        targetSystem: 'as400',
        supportEndSoon: 'yes',
        troubles: ['no_documents', 'few_maintainers'],
        heard: 'AS/400 で約25年',
      })
    ).toBe(
      [
        '顧客探しの記録（2026-10-21、山田）',
        '相手: 情報システム部 / 佐藤',
        '対象システム: as400',
        '保守期限: 1年以内',
        '困りごと: 資料がない、担当者が少ない・属人化',
        '聞いた話: AS/400 で約25年',
      ].join('\n')
    );
    expect(
      leadNoteFromProspect({
        contactedOn: '2026-10-21',
        recorder: null,
        department: null,
        jobTitle: null,
        surname: null,
        targetSystem: null,
        supportEndSoon: null,
        troubles: [],
        heard: null,
      })
    ).toBe('顧客探しの記録（2026-10-21、記入者不明）');
  });
});
