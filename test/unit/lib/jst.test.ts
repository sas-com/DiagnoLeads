import { dashboardPeriod, jstDay } from '@/lib/jst';
import { describe, expect, it } from 'vitest';

describe('jstDay', () => {
  it('turns to the next Japanese day at 15:00 UTC', () => {
    expect(jstDay(new Date('2026-10-15T14:59:59.999Z'))).toBe('2026-10-15');
    expect(jstDay(new Date('2026-10-15T15:00:00Z'))).toBe('2026-10-16');
  });

  it('crosses months and years on the Japanese calendar', () => {
    expect(jstDay(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01');
    expect(jstDay(new Date('2026-02-28T15:00:00Z'))).toBe('2026-03-01');
  });
});

describe('dashboardPeriod', () => {
  const now = new Date('2026-10-16T03:00:00Z'); // 12:00 on 10/16 in Japan

  it('starts at the beginning of the Japanese day, days - 1 days ago, and ends now', () => {
    const { from, to } = dashboardPeriod(7, now);
    expect(from.toISOString()).toBe('2026-10-09T15:00:00.000Z'); // 10/10 00:00 in Japan
    expect(to).toBe(now);
  });

  it('puts the previous period right before it, with the same length', () => {
    const { from, previousFrom } = dashboardPeriod(7, now);
    expect(previousFrom.toISOString()).toBe('2026-10-02T15:00:00.000Z');
    expect(from.getTime() - previousFrom.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('counts only today for one day, from the start of the Japanese day', () => {
    const { from } = dashboardPeriod(1, new Date('2026-10-15T15:30:00Z')); // 00:30 on 10/16
    expect(from.toISOString()).toBe('2026-10-15T15:00:00.000Z');
  });

  it('keeps the Japanese day until its last millisecond', () => {
    const { from } = dashboardPeriod(1, new Date('2026-10-15T14:59:59.999Z')); // 23:59:59.999 on 10/15
    expect(from.toISOString()).toBe('2026-10-14T15:00:00.000Z');
  });
});
