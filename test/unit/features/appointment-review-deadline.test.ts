/**
 * Deadline to report an appointment that missed the agreed conditions (Refs #149).
 * Acceptance: the business-day deadline, and a review recorded after it marked "late".
 * 2026-10-16 is a Friday.
 */
import {
  addBusinessDays,
  businessDaysBetween,
  deadlineStatus,
  isRecordedLate,
  noticeWindow,
  reviewDeadline,
} from '@/lib/features/appointment-reviews/deadline';
import { describe, expect, it } from 'vitest';

describe('addBusinessDays', () => {
  it('skips Saturdays and Sundays', () => {
    // Thu → Fri, Fri → Mon, Sat → Mon, Sun → Mon
    expect(addBusinessDays('2026-10-15', 1)).toBe('2026-10-16');
    expect(addBusinessDays('2026-10-16', 1)).toBe('2026-10-19');
    expect(addBusinessDays('2026-10-17', 1)).toBe('2026-10-19');
    expect(addBusinessDays('2026-10-18', 1)).toBe('2026-10-19');
    // Fri + 3 → Wed
    expect(addBusinessDays('2026-10-16', 3)).toBe('2026-10-21');
    // Across a month end: Fri 10-30 + 1 → Mon 11-02
    expect(addBusinessDays('2026-10-30', 1)).toBe('2026-11-02');
  });

  it('keeps the day itself for 0', () => {
    expect(addBusinessDays('2026-10-17', 0)).toBe('2026-10-17');
  });
});

describe('reviewDeadline', () => {
  it('is "by the next business day after the visit" for 1, and none without a rule', () => {
    expect(reviewDeadline('2026-10-16', 1)).toBe('2026-10-19');
    expect(reviewDeadline('2026-10-16', null)).toBeNull();
  });
});

describe('businessDaysBetween', () => {
  it('counts the business days after the first day up to the second', () => {
    expect(businessDaysBetween('2026-10-16', '2026-10-19')).toBe(1);
    expect(businessDaysBetween('2026-10-15', '2026-10-21')).toBe(4);
    expect(businessDaysBetween('2026-10-19', '2026-10-16')).toBe(-1);
    expect(businessDaysBetween('2026-10-16', '2026-10-16')).toBe(0);
  });
});

describe('deadlineStatus', () => {
  it('tells how many business days are left, today, or passed', () => {
    expect(deadlineStatus('2026-10-21', '2026-10-16')).toEqual({ state: 'open', businessDaysLeft: 3 });
    // Saturday before a Monday deadline: still 1 business day
    expect(deadlineStatus('2026-10-19', '2026-10-17')).toEqual({ state: 'open', businessDaysLeft: 1 });
    expect(deadlineStatus('2026-10-19', '2026-10-19')).toEqual({ state: 'today' });
    expect(deadlineStatus('2026-10-19', '2026-10-20')).toEqual({ state: 'passed' });
    expect(deadlineStatus(null, '2026-10-20')).toEqual({ state: 'none' });
  });
});

describe('isRecordedLate', () => {
  it('marks a review recorded after the deadline, and never one without a deadline', () => {
    expect(isRecordedLate('2026-10-19', '2026-10-19')).toBe(false);
    expect(isRecordedLate('2026-10-19', '2026-10-20')).toBe(true);
    expect(isRecordedLate(null, '2030-01-01')).toBe(false);
  });
});

describe('noticeWindow', () => {
  it('covers today up to the next business day', () => {
    expect(noticeWindow('2026-10-15')).toEqual({ from: '2026-10-15', to: '2026-10-16' });
    // Friday: a Monday deadline is announced too
    expect(noticeWindow('2026-10-16')).toEqual({ from: '2026-10-16', to: '2026-10-19' });
  });
});
