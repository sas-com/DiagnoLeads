/**
 * "When to act" of a lead (Refs #151). Acceptance: with only some of the dates known, the
 * earliest is used and the unknown ones are ignored.
 */
import {
  addMonths,
  budgetPlanningMonth,
  computeActTiming,
  diagnosisSupportEndMonth,
} from '@/lib/features/act-timing/compute';
import { DEFAULT_ACT_TIMING_SETTINGS, readActTimingSettings } from '@/lib/features/act-timing/types/schemas';
import { describe, expect, it } from 'vitest';

const settings = DEFAULT_ACT_TIMING_SETTINGS; // 12 months to migrate, told 3 months before

describe('computeActTiming', () => {
  it('uses the earliest of the support end and the retirement', () => {
    expect(
      computeActTiming({ hardwareSupportEnd: '2028-09', earliestRetirement: '2028-03' }, settings)
    ).toEqual({
      actBy: '2027-03',
      deadline: { month: '2028-03', source: 'retirement' },
      start: '2027-03',
      budgetPlanning: null,
      noticeOn: '2026-12-01',
    });
  });

  it('ignores what is unknown', () => {
    expect(computeActTiming({ hardwareSupportEnd: '2028-09' }, settings)?.deadline).toEqual({
      month: '2028-09',
      source: 'supportEnd',
    });
    expect(
      computeActTiming({ hardwareSupportEnd: null, earliestRetirement: '2029-01' }, settings)
        ?.actBy
    ).toBe('2028-01');
    // Broken values count as unknown
    expect(
      computeActTiming({ hardwareSupportEnd: '2028-13', earliestRetirement: 'soon' }, settings)
    ).toBeNull();
    expect(computeActTiming({ fiscalYearEndMonth: 3 }, settings)).toBeNull();
  });

  it('moves the start back to the budget planning before the fiscal year end', () => {
    // FY ends in March: budgets are planned in December. Start 2027-09 → back to 2026-12
    const timing = computeActTiming(
      { hardwareSupportEnd: '2028-09', fiscalYearEndMonth: 3 },
      settings
    );
    expect(timing).toMatchObject({ start: '2027-09', budgetPlanning: '2026-12', actBy: '2026-12' });
    expect(timing?.noticeOn).toBe('2026-09-01');
    // A start in the planning month itself stays
    expect(
      computeActTiming({ hardwareSupportEnd: '2027-12', fiscalYearEndMonth: 3 }, settings)?.actBy
    ).toBe('2026-12');
  });

  it('falls back to the diagnosis answer when the hearing has no support end', () => {
    const diagnosisSupportEnd = { answer: 'within_1y', answeredOn: '2026-10-16' };
    expect(computeActTiming({ diagnosisSupportEnd }, settings)?.deadline).toEqual({
      month: '2027-04',
      source: 'diagnosisSupportEnd',
    });
    // The hearing's date wins over the diagnosis estimate, even when later
    expect(
      computeActTiming({ diagnosisSupportEnd, hardwareSupportEnd: '2029-01' }, settings)?.deadline
        .source
    ).toBe('supportEnd');
    // But the retirement still counts with the estimate
    expect(
      computeActTiming({ diagnosisSupportEnd, earliestRetirement: '2027-01' }, settings)?.deadline
        .source
    ).toBe('retirement');
  });

  it('follows the organization settings', () => {
    expect(
      computeActTiming(
        { hardwareSupportEnd: '2028-09' },
        { migrationMonths: 18, noticeMonths: 0 }
      )
    ).toMatchObject({ actBy: '2027-03', noticeOn: '2027-03-01' });
  });
});

describe('helpers', () => {
  it('reads the diagnosis answer as a month', () => {
    expect(diagnosisSupportEndMonth({ answer: 'passed', answeredOn: '2026-10-16' })).toBe('2026-10');
    expect(diagnosisSupportEndMonth({ answer: '1_3y', answeredOn: '2026-10-16' })).toBe('2028-10');
    expect(diagnosisSupportEndMonth({ answer: 'beyond_3y', answeredOn: '2026-10-16' })).toBeNull();
    expect(diagnosisSupportEndMonth({ answer: 'unknown', answeredOn: '2026-10-16' })).toBeNull();
    expect(diagnosisSupportEndMonth(null)).toBeNull();
  });

  it('finds the last budget planning month', () => {
    // FY end March → planning December; FY end December → planning September
    expect(budgetPlanningMonth('2027-09', 3)).toBe('2026-12');
    expect(budgetPlanningMonth('2027-01', 3)).toBe('2026-12');
    expect(budgetPlanningMonth('2027-12', 3)).toBe('2027-12');
    expect(budgetPlanningMonth('2027-08', 12)).toBe('2026-09');
    expect(budgetPlanningMonth('2027-09', 12)).toBe('2027-09');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
  });

  it('reads the settings with defaults', () => {
    expect(readActTimingSettings({ actTiming: { migrationMonths: 24 } })).toEqual({
      migrationMonths: 24,
      noticeMonths: 3,
    });
    expect(readActTimingSettings({ actTiming: { migrationMonths: 0 } })).toEqual(
      DEFAULT_ACT_TIMING_SETTINGS
    );
    expect(readActTimingSettings(null)).toEqual({ migrationMonths: 12, noticeMonths: 3 });
  });
});
