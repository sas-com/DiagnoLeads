/**
 * Pure helpers of the dashboard: deadline lateness, trend buckets, platform order, display formats
 */
import { bucketTrend, deadlineStatus, sortPlatforms } from '@/lib/features/analytics/dashboard';
import {
  jstShortDay,
  periodDelta,
  periodRange,
  receivedAt,
  shortDay,
  signed,
} from '@/lib/features/analytics/dashboard-format';
import { describe, expect, it } from 'vitest';

describe('deadlineStatus', () => {
  // Friday 2026-10-16
  const today = '2026/10/16';

  it('counts lateness in business days, skipping weekends', () => {
    expect(deadlineStatus('2026/10/15', today)).toEqual({ due: 'overdue', businessDays: 1 });
    // Fri 10/9 → Fri 10/16: five business days
    expect(deadlineStatus('2026/10/09', today)).toEqual({ due: 'overdue', businessDays: 5 });
    expect(deadlineStatus('2026/09/29', today)).toEqual({ due: 'overdue', businessDays: 13 });
  });

  it('is at least one business day late on a weekend', () => {
    // Deadline Friday, seen on Saturday and Sunday
    expect(deadlineStatus('2026/10/16', '2026/10/17')).toEqual({ due: 'overdue', businessDays: 1 });
    expect(deadlineStatus('2026/10/16', '2026/10/18')).toEqual({ due: 'overdue', businessDays: 1 });
  });

  it('names today and tomorrow, and counts the business days left after that', () => {
    expect(deadlineStatus('2026/10/16', today)).toEqual({ due: 'today', businessDays: 0 });
    expect(deadlineStatus('2026/10/15', '2026/10/14')).toEqual({ due: 'tomorrow', businessDays: 1 });
    // Friday → Monday is the next business day, not "tomorrow"
    expect(deadlineStatus('2026/10/19', today)).toEqual({ due: 'later', businessDays: 1 });
    expect(deadlineStatus('2026/10/21', today)).toEqual({ due: 'later', businessDays: 3 });
  });
});

describe('bucketTrend', () => {
  const days = (count: number, start = '2026-07-19') =>
    Array.from({ length: count }, (_, i) => {
      const date = new Date(`${start}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + i);
      return { date: date.toISOString().slice(0, 10), leads: 1, consultations: i % 2 };
    });

  it('keeps one bar per day up to 30 days', () => {
    const trend = bucketTrend(days(30));
    expect(trend.unit).toBe('day');
    expect(trend.points).toHaveLength(30);
    expect(trend.points[0]).toEqual({ start: '2026-07-19', end: '2026-07-19', leads: 1, consultations: 0 });
  });

  it('adds up Monday-to-Sunday weeks beyond 30 days, cut at the period edges', () => {
    // 2026-07-19 is a Sunday; 90 days end on 2026-10-16 (Friday)
    const trend = bucketTrend(days(90));
    expect(trend.unit).toBe('week');
    expect(trend.points[0]).toEqual({ start: '2026-07-19', end: '2026-07-19', leads: 1, consultations: 0 });
    expect(trend.points[1]).toEqual({ start: '2026-07-20', end: '2026-07-26', leads: 7, consultations: 4 });
    expect(trend.points.at(-1)).toEqual({ start: '2026-10-12', end: '2026-10-16', leads: 5, consultations: 3 });
    expect(trend.points.reduce((sum, p) => sum + p.leads, 0)).toBe(90);
    expect(trend.points).toHaveLength(14);
  });
});

describe('sortPlatforms', () => {
  it('puts the most leads first and "unknown" always last', () => {
    expect(
      sortPlatforms([
        { platform: 'unknown', count: 9 },
        { platform: 'acos', count: 5 },
        { platform: 'as400', count: 17 },
      ]).map((p) => p.platform)
    ).toEqual(['as400', 'acos', 'unknown']);
  });
});

describe('dashboard formats', () => {
  it('writes every day as M/D on the Japan calendar', () => {
    expect(shortDay('2026/09/29')).toBe('9/29');
    expect(shortDay('2026-10-05')).toBe('10/5');
    expect(jstShortDay(new Date('2026-10-15T15:30:00Z'))).toBe('10/16');
    expect(periodRange(30, new Date('2026-10-16T06:00:00Z'))).toEqual({ from: '9/17', to: '10/16' });
  });

  it('says today with the time, yesterday, or the date', () => {
    const now = new Date('2026-10-16T06:00:00Z'); // 15:00 JST
    expect(receivedAt(new Date('2026-10-16T02:20:00Z'), now)).toEqual({ kind: 'today', time: '11:20' });
    expect(receivedAt(new Date('2026-10-15T14:59:00Z'), now)).toEqual({ kind: 'yesterday' });
    expect(receivedAt(new Date('2026-10-14T03:00:00Z'), now)).toEqual({ kind: 'date', date: '10/14' });
  });

  it('gives the change with a percent only when there was something before', () => {
    expect(periodDelta(45, 23)).toEqual({ delta: 22, type: 'increase', rate: 96 });
    expect(periodDelta(6, 0)).toEqual({ delta: 6, type: 'increase', rate: null });
    expect(periodDelta(4, 5)).toEqual({ delta: -1, type: 'decrease', rate: -20 });
    expect(periodDelta(0, 0)).toEqual({ delta: 0, type: 'unchanged', rate: null });
    expect([signed(22), signed(-3), signed(0)]).toEqual(['+22', '−3', '±0']);
  });
});
