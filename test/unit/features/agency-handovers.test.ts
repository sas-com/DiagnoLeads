/**
 * The agency's appointment report (#152): finding the columns (our format and other names),
 * reading the cells, the template, and the hearing prefill from a handover. Values are made up.
 */
import {
  detectHandoverMapping,
  handoverTemplateCsv,
  readDate,
  readHandoverRow,
  readYearMonth,
} from '@/lib/features/agency-handovers/columns';
import { handoverHearingFields } from '@/lib/features/agency-handovers/service';
import { handoverRowSchema } from '@/lib/features/agency-handovers/types/schemas';
import { parseCSV } from '@/lib/features/leads/import-service';
import { describe, expect, it } from 'vitest';

describe('detectHandoverMapping', () => {
  it('finds our column names and other names, ignoring spaces and case', () => {
    const mapping = detectHandoverMapping(['E-Mail', '企業名', '温度感', ' 機種 ', '関係ない列']);
    expect(mapping).toMatchObject({
      email: 'E-Mail',
      company: '企業名',
      interestLevel: '温度感',
      machineModel: ' 機種 ',
      note: null,
    });
  });
});

describe('reading cells', () => {
  it('reads dates and year-months in the usual ways', () => {
    expect(readDate('2026/11/5')).toBe('2026-11-05');
    expect(readDate('2026年11月5日')).toBe('2026-11-05');
    expect(readDate('来週')).toBeNull();
    expect(readYearMonth('2028/3')).toBe('2028-03');
    expect(readYearMonth('2028年3月')).toBe('2028-03');
    expect(readYearMonth('2028-03-31')).toBe('2028-03');
    expect(readYearMonth('2028/13')).toBeNull();
    // Excel keeps dates as serial numbers
    expect(readDate('46331')).toBe('2026-11-05');
    expect(readYearMonth('46813')).toBe('2028-03');
    expect(readDate('12345')).toBeNull();
  });

  it('reads a row, leaving cells it cannot read empty and reporting them', () => {
    const mapping = detectHandoverMapping(['メールアドレス', '機種の確認', '決裁者の同席', '関心度', '保守期限']);
    const { row, problems } = readHandoverRow(
      { メールアドレス: 'Yamada@Example.co.jp', 機種の確認: '確認済み', 決裁者の同席: 'なし', 関心度: '高', 保守期限: 'そのうち' },
      mapping
    );
    expect(row).toMatchObject({
      email: 'yamada@example.co.jp',
      machineModelConfirmed: true,
      decisionMakerPresent: 'no',
      interestLevel: 'high',
      hardwareSupportEnd: null,
    });
    expect(problems).toEqual([{ column: 'hardwareSupportEnd', value: 'そのうち' }]);
  });

  it('reads its own template back into a valid row', () => {
    const { headers, rows } = parseCSV(handoverTemplateCsv());
    const { row, problems } = readHandoverRow(rows[0], detectHandoverMapping(headers));
    expect(problems).toEqual([]);
    expect(handoverRowSchema.parse(row)).toMatchObject({
      email: 'yamada@example.co.jp',
      appointmentOn: '2026-11-05',
      hardwareSupportEnd: '2028-03',
      retirementPlan: '2027-09',
      decisionMakerPresent: 'yes',
      interestLevel: 'high',
    });
  });

  it('needs an email address or a company name', () => {
    expect(handoverRowSchema.safeParse({ machineModel: 'Power 9' }).success).toBe(false);
    expect(handoverRowSchema.safeParse({ company: '架空商事' }).success).toBe(true);
  });
});

describe('handoverHearingFields', () => {
  const handover = {
    machineModel: 'IBM Power 9',
    hardwareSupportEnd: '2028-03',
    retirementPlan: '2027-09',
    decisionMakerPresent: 'maybe',
  };

  it('fills what the diagnosis did not, as the agency’s and not confirmed', () => {
    const fields = handoverHearingFields(handover, {
      hardwareSupportEnd: { value: '2027-12', status: 'not_yet', source: 'prefilled' },
    });
    expect(fields).toEqual({
      machineModel: { value: 'IBM Power 9', status: 'not_yet', source: 'agency' },
      // The diagnosis value stays
      hardwareSupportEnd: { value: '2027-12', status: 'not_yet', source: 'prefilled' },
      earliestRetirement: { value: '2027-09', status: 'not_yet', source: 'agency' },
      // Not an option of the hearing: left out
    });
  });

  it('changes nothing without a handover', () => {
    expect(handoverHearingFields(null, {})).toEqual({});
  });
});
