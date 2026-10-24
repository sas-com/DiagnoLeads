/**
 * Formatting of the deals screens (#436): yen amounts, days in a stage and the close periods
 */
import {
  daysSince,
  formatYen,
  formatYenCompact,
  isDealPeriod,
  periodRange,
} from '@/components/features/deals/deal-format';
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
