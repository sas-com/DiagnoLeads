/**
 * A sales agency's call report (#161): finding the columns, reading the cells, the next contact
 * as a date or a rough time, the template, and the summary of calls. Values are made up.
 */
import { parseCSV } from '@/lib/features/leads/import-service';
import {
  callTemplateCsv,
  detectCallMapping,
  readCallRow,
} from '@/lib/features/prospects/call-report';
import { summarizeProspects } from '@/lib/features/prospects/summary';
import { importCallRowSchema } from '@/lib/features/prospects/types/schemas';
import { describe, expect, it } from 'vitest';

describe('readCallRow', () => {
  const mapping = detectCallMapping(['企業名', '結果', 'お断り理由', '再架電時期', '基幹システム', '担当者']);

  it('reads results, reasons and systems written in the usual ways', () => {
    const { row, problems } = readCallRow(
      { 企業名: '架空工業', 結果: 'お断り', お断り理由: '予算がない', 再架電時期: '2027/4/1', 基幹システム: 'AS/400', 担当者: '山田 太郎' },
      mapping
    );
    expect(problems).toEqual([]);
    expect(row).toMatchObject({
      company: '架空工業',
      callResult: 'refused',
      refusalReason: 'budget',
      nextActionOn: '2027-04-01',
      nextActionNote: null,
      targetSystem: 'as400',
      contactName: '山田 太郎',
    });
  });

  it('keeps a rough next contact as a note and reports cells it cannot read', () => {
    const { row, problems } = readCallRow(
      { 企業名: '架空工業', 結果: '検討中かも', 再架電時期: '来年の春' },
      mapping
    );
    expect(row).toMatchObject({ callResult: null, nextActionOn: null, nextActionNote: '来年の春' });
    expect(problems).toEqual([{ column: 'callResult', value: '検討中かも' }]);
  });

  it('skips a row without a company', () => {
    expect(readCallRow({ 結果: '不在' }, mapping).row).toBeNull();
  });

  it('reads its own template back into a valid row', () => {
    const { headers, rows } = parseCSV(callTemplateCsv());
    const { row, problems } = readCallRow(rows[0], detectCallMapping(headers));
    expect(problems).toEqual([]);
    expect(importCallRowSchema.parse(row)).toMatchObject({
      company: '架空工業株式会社',
      agencyName: '架空テレアポ',
      calledOn: '2026-11-05',
      callResult: 'refused',
      refusalReason: 'budget',
      nextActionOn: '2027-04-01',
      targetSystem: 'as400',
    });
  });
});

describe('summarizeProspects: calls', () => {
  const row = (values: Record<string, string | null>) => ({
    contactedOn: '2026-10-01',
    entry: 'sales_agency',
    reaction: null,
    nextStep: null,
    nextActionOn: null,
    nextActionNote: null,
    stage: null,
    meetingOn: null,
    ...values,
  });

  it('counts the results and why calls were turned down, and leaves turned-down rows out of overdue', () => {
    const summary = summarizeProspects(
      [
        row({ callResult: 'refused', refusalReason: 'budget', nextActionOn: '2026-10-01' }),
        row({ callResult: 'refused', refusalReason: 'budget' }),
        row({ callResult: 'refused', refusalReason: 'priority' }),
        row({ callResult: 'appointment' }),
        row({ callResult: 'absent', nextActionOn: '2026-10-01' }),
        row({ entry: 'member_network' }),
      ],
      [],
      '2026-10-21'
    );
    expect(summary.calls).toEqual({
      total: 5,
      byResult: { appointment: 1, refused: 3, absent: 1, callback: 0 },
      refusals: { budget: 2, staffing: 0, risk: 0, priority: 1, vendor: 0, other: 0 },
    });
    // Only the absent one: the turned-down one is in the re-approach list
    expect(summary.checks.overdue).toBe(1);
    expect(summary.entries.find((entry) => entry.entry === 'sales_agency')?.total).toBe(5);
  });
});
