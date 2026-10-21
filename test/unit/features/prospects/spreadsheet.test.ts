import { parseProspectRows, parseProspectWorkbook } from '@/lib/features/prospects/spreadsheet';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

// The layout of the "customer search" spreadsheet: title rows, then the header (fictional values)
const HEADER = [
  '日付',
  '入口',
  '会社名',
  '部門',
  '役職',
  '苗字',
  '説明日',
  '聞いた話(システムの種類・古さ、困りごと、見直しの時期)',
  '基幹システムor 周辺システム',
  '反応',
  '次の一手',
  '次回アクション日',
  '記入者',
  '更新日(記入・修正した日)',
  '現在の段階',
  '商談日',
  '営業担当',
  '備考',
];
const TITLE = [['顧客探し一覧'], ['黄色の列は…'], []];
const EXAMPLE = [
  new Date(2026, 9, 26),
  '① SASメンバーのつて',
  '株式会社サンプル製作所',
  '情報システム部',
  '部長',
  '佐藤',
  new Date(2026, 9, 26),
  'AS/400で約25年',
  '基幹',
  '検討中',
  '営業へ引き継ぎ',
  new Date(2026, 10, 2),
  '第○SI部 山田',
  new Date(2026, 9, 26),
  '1 関心確認',
  null,
  null,
  '【記入例】',
];

describe('parseProspectRows', () => {
  it('maps the dropdown labels and dates, and skips the example row', () => {
    const parsed = parseProspectRows([
      ...TITLE,
      HEADER,
      EXAMPLE,
      [
        new Date(2026, 9, 14),
        '② 既存エンド顧客',
        '架空工業',
        '情報システム部',
        '課長',
        '鈴木',
        '2026/09/30',
        'オフコンが残っている\n業務効率化',
        '周辺',
        '予定なし',
        '見送り',
        '-',
        '高橋',
        '-',
        '育成',
        null,
        '田中',
        '年明けに再確認',
      ],
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.skipped).toBe(1);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toEqual({
      line: 6,
      row: {
        contactedOn: '2026-10-14',
        entry: 'existing_end_customer',
        company: '架空工業',
        department: '情報システム部',
        jobTitle: '課長',
        surname: '鈴木',
        explainedOn: '2026-09-30',
        heard: 'オフコンが残っている\n業務効率化',
        systemScope: 'peripheral',
        reaction: 'no_plan',
        nextStep: 'pass',
        nextActionOn: null,
        nextActionNote: null,
        recorderName: '高橋',
        updatedOn: null,
        stage: 'nurturing',
        meetingOn: null,
        salesName: '田中',
        remarks: '年明けに再確認',
      },
    });
  });

  it('keeps values that fit no column in the remarks, and a rough next action as its note', () => {
    const parsed = parseProspectRows([
      HEADER,
      [
        new Date(2026, 9, 1),
        '③ BP会社',
        '架空商事',
        null,
        '取締役\n情報システム部長',
        null,
        '来週',
        null,
        null,
        'とても困っている',
        null,
        '11月中旬',
        null,
        null,
        null,
        null,
        null,
        '紹介者経由',
      ],
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]?.row).toMatchObject({
      jobTitle: '取締役 情報システム部長',
      explainedOn: null,
      reaction: null,
      nextActionOn: null,
      nextActionNote: '11月中旬',
      remarks: '紹介者経由\n説明日（元の記入）: 来週\n反応（元の記入）: とても困っている',
    });
    expect(parsed.notices).toEqual([
      { line: 2, message: '説明日「来週」は備考に残します' },
      { line: 2, message: '反応「とても困っている」は備考に残します' },
    ]);
  });

  it('does not import a row without a readable date or a known entry', () => {
    const parsed = parseProspectRows([
      HEADER,
      [null, '⑤ その他(交流会など)', '架空電機'],
      ['10月上旬', '⑤ その他(交流会など)', '架空電機'],
      [new Date(2026, 9, 1), '⑥ 展示会', '架空物産'],
    ]);
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([
      { line: 2, message: '日付がありません' },
      { line: 3, message: '日付「10月上旬」は日付として読めません' },
      { line: 4, message: '入口「⑥ 展示会」は選択肢にありません' },
    ]);
  });

  it('skips rows without a company and fails without the header', () => {
    expect(parseProspectRows([HEADER, [null, '① SASメンバーのつて']]).skipped).toBe(1);
    expect(parseProspectRows([['会社']]).errors[0]?.message).toContain('見出し');
  });

  it('rejects dates that do not exist or are out of range, and reads Windows line breaks', () => {
    const parsed = parseProspectRows([
      HEADER,
      ['2026/13/45', '③ BP会社', '架空商事'],
      ['1999/12/31', '③ BP会社', '架空商事'],
      [new Date(2026, 9, 1), '③ BP会社', '架空物産', null, null, null, null, '一行目\r\n二行目'],
      [new Date(2026, 9, 1), 'constructor', '架空電機'],
    ]);
    expect(parsed.errors).toEqual([
      { line: 2, message: '日付「2026/13/45」は日付として読めません' },
      { line: 3, message: '日付「1999/12/31」は日付として読めません' },
      { line: 5, message: '入口「constructor」は選択肢にありません' },
    ]);
    expect(parsed.rows[0]?.row.heard).toBe('一行目\n二行目');
  });

  it('reads a workbook, preferring the list sheet over the others', () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['使い方']]), '使い方');
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([...TITLE, HEADER, [new Date(2026, 9, 3), '④ マーケ流入', '架空精機']], {
        cellDates: true,
      }),
      '顧客探し一覧'
    );
    const buffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const parsed = parseProspectWorkbook(buffer);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]?.row).toMatchObject({
      contactedOn: '2026-10-03',
      entry: 'marketing',
      company: '架空精機',
    });
  });
});
