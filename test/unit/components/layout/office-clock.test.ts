import { hourIn, isNightHour } from '@/components/layout/office-clock';
import { describe, expect, it } from 'vitest';

describe('the clock of the office', () => {
  it('is night from 18:00 to 6:00', () => {
    expect([5, 6, 12, 17, 18, 23, 0].map(isNightHour)).toEqual([
      true,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it('reads the hour in the time zone the app shows', () => {
    // 16:29 UTC is 01:29 the next day in Japan
    const now = new Date('2026-11-12T16:29:00Z');
    expect(hourIn(now, 'Asia/Tokyo')).toBe(1);
    expect(hourIn(now, 'UTC')).toBe(16);
    expect(hourIn(new Date('2026-11-12T15:00:00Z'), 'Asia/Tokyo')).toBe(0);
  });
});
