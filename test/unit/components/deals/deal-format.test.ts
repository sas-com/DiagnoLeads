/**
 * Formatting of the deals screens (#436, #720): yen amounts, days in a stage, the close periods,
 * the days as the screens write them, a card's marks and the checks of typed values
 */
import {
  daysSince,
  dealMarks,
  formatDealDate,
  formatYen,
  formatYenCompact,
  isDealDate,
  isDealPeriod,
  parseAmount,
  parseWhole,
  periodRange,
} from '@/components/features/deals/deal-format';
import { DEAL_LIMITS } from '@/lib/features/deals/types/schemas';
import { describe, expect, it } from 'vitest';

describe('formatYen', () => {
  it('formats whole yen and leaves a missing amount empty', () => {
    expect(formatYen(3_000_000, 'ja')).toMatch(/3,000,000/);
    expect(formatYen(0, 'en')).toMatch(/0/);
    expect(formatYen(null, 'ja')).toBeNull();
  });

  it('shortens the column totals', () => {
    expect(formatYenCompact(12_000_000, 'ja')).toMatch(/1200万/);
    expect(formatYenCompact(12_000_000, 'en')).toMatch(/12M/);
  });
});

describe('daysSince', () => {
  it('counts whole days and never goes below zero', () => {
    const now = new Date('2026-10-24T09:00:00Z');
    expect(daysSince(new Date('2026-10-21T10:00:00Z'), now)).toBe(2);
    expect(daysSince('2026-10-24T08:00:00Z', now)).toBe(0);
    expect(daysSince(new Date('2026-10-25T00:00:00Z'), now)).toBe(0);
  });
});

describe('periodRange', () => {
  it.each([
    ['thisMonth', '2026-10-24', { closeFrom: '2026-10-01', closeTo: '2026-10-31' }],
    ['nextMonth', '2026-12-05', { closeFrom: '2027-01-01', closeTo: '2027-01-31' }],
    ['nextMonth', '2028-01-31', { closeFrom: '2028-02-01', closeTo: '2028-02-29' }],
    ['thisQuarter', '2026-10-24', { closeFrom: '2026-10-01', closeTo: '2026-12-31' }],
    ['thisQuarter', '2027-03-31', { closeFrom: '2027-01-01', closeTo: '2027-03-31' }],
    ['thisQuarter', '2026-04-01', { closeFrom: '2026-04-01', closeTo: '2026-06-30' }],
    ['all', '2026-10-24', {}],
  ] as const)('%s from %s', (period, today, expected) => {
    expect(periodRange(period, today)).toEqual(expected);
  });

  it('knows its periods', () => {
    expect(isDealPeriod('thisQuarter')).toBe(true);
    expect(isDealPeriod('lastYear')).toBe(false);
    expect(isDealPeriod(null)).toBe(false);
  });
});

describe('parseWhole', () => {
  it('reads a whole number up to the limit, empty as none', () => {
    expect(parseWhole(' 3000000 ', 1_000_000_000_000)).toBe(3_000_000);
    expect(parseWhole('', 100)).toBeNull();
    expect(parseWhole('101', 100)).toBe('invalid');
    expect(parseWhole('3.5', 100)).toBe('invalid');
    expect(parseWhole('-1', 100)).toBe('invalid');
  });
});

describe('isDealDate', () => {
  it('takes the real days from 2000 to 2100 that the API takes', () => {
    expect(isDealDate('2026-10-25')).toBe(true);
    expect(isDealDate('2100-12-31')).toBe(true);
    expect(isDealDate('1999-12-31')).toBe(false);
    expect(isDealDate('2101-01-01')).toBe(false);
    expect(isDealDate('2026-02-30')).toBe(false);
  });
});

describe('parseAmount', () => {
  it.each([
    ['12000000', 12_000_000],
    ['12,000,000', 12_000_000],
    [' 12 000 000 ', 12_000_000],
    ['１２，０００，０００', 12_000_000],
    ['１２\u3000０００\u3000０００', 12_000_000],
    ['0', 0],
    // A yen sign before or 円 after, as amounts are written (#720)
    ['¥3,000,000', 3_000_000],
    ['￥3,000,000', 3_000_000],
    ['3,000,000円', 3_000_000],
    [' ￥ ３，０００，０００ 円 ', 3_000_000],
  ])('reads %s as yen', (typed, amount) => {
    expect(parseAmount(typed)).toBe(amount);
  });

  it('reads an empty box as no amount', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(' , ')).toBeNull();
    expect(parseAmount('¥')).toBeNull();
  });

  it.each(['1200万', '3.5', '-1', '1e6', '¥¥3,000', '3,000円円', '円3,000', '3,000¥', '$3,000'])(
    'does not read %s',
    (typed) => {
      expect(parseAmount(typed)).toBe('invalid');
    }
  );

  it('stops at the amount the API takes', () => {
    expect(parseAmount(String(DEAL_LIMITS.amount))).toBe(DEAL_LIMITS.amount);
    expect(parseAmount(String(DEAL_LIMITS.amount + 1))).toBe('invalid');
  });
});

describe('formatDealDate', () => {
  it('writes a day as the date boxes and the lead pages do', () => {
    expect(formatDealDate('2026-10-25')).toBe('2026/10/25');
  });
});

describe('dealMarks', () => {
  const deal = { stage: 'proposal', expectedCloseOn: '2026-11-30', hasOpenTask: true };

  it('marks an open deal past its close date or whose lead has no next action', () => {
    expect(dealMarks(deal, '2026-10-24')).toEqual({ overdue: false, noNextAction: false });
    expect(dealMarks({ ...deal, expectedCloseOn: '2026-10-23' }, '2026-10-24').overdue).toBe(true);
    // Due today is not overdue yet
    expect(dealMarks({ ...deal, expectedCloseOn: '2026-10-24' }, '2026-10-24').overdue).toBe(false);
    expect(dealMarks({ ...deal, hasOpenTask: false }, '2026-10-24').noNextAction).toBe(true);
    expect(dealMarks({ ...deal, expectedCloseOn: null }, '2026-10-24').overdue).toBe(false);
  });

  it('does not mark won or lost deals', () => {
    for (const stage of ['won', 'lost']) {
      expect(
        dealMarks({ stage, expectedCloseOn: '2026-01-01', hasOpenTask: false }, '2026-10-24')
      ).toEqual({ overdue: false, noNextAction: false });
    }
  });
});
