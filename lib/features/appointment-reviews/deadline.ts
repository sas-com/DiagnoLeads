/**
 * Deadline to report an appointment that missed the agreed conditions (Refs #149). Pure
 * functions on Japan calendar days ('YYYY-MM-DD').
 *
 * Business days skip Saturdays and Sundays; public holidays are not taken into account (same as
 * the contact deadline of consultation requests). A deadline of N business days after the first
 * meeting is the N-th business day after it (1 = "by the next business day"); 0 is the meeting
 * day itself.
 */

const weekday = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`).getUTCDay();
const isWeekend = (isoDate: string) => {
  const day = weekday(isoDate);
  return day === 0 || day === 6;
};

function shift(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The N-th business day after a day (N = 0: the day itself) */
export function addBusinessDays(isoDate: string, businessDays: number): string {
  let day = isoDate;
  let left = businessDays;
  while (left > 0) {
    day = shift(day, 1);
    if (!isWeekend(day)) left -= 1;
  }
  return day;
}

/** Last day to report the appointment, or null when the contract has no such rule */
export function reviewDeadline(meetingOn: string, businessDays: number | null): string | null {
  return businessDays === null ? null : addBusinessDays(meetingOn, businessDays);
}

/** Business days from `from` (excluded) to `to` (included); negative when `to` is earlier */
export function businessDaysBetween(from: string, to: string): number {
  if (from === to) return 0;
  const [start, end, sign] = from < to ? [from, to, 1] : [to, from, -1];
  let count = 0;
  for (let day = shift(start, 1); day <= end; day = shift(day, 1)) {
    if (!isWeekend(day)) count += 1;
  }
  return count * sign;
}

export type DeadlineStatus =
  | { state: 'none' }
  | { state: 'open'; businessDaysLeft: number }
  | { state: 'today' }
  | { state: 'passed' };

/** Where today stands against the deadline */
export function deadlineStatus(deadlineOn: string | null, today: string): DeadlineStatus {
  if (deadlineOn === null) return { state: 'none' };
  if (today > deadlineOn) return { state: 'passed' };
  if (today === deadlineOn) return { state: 'today' };
  return { state: 'open', businessDaysLeft: Math.max(1, businessDaysBetween(today, deadlineOn)) };
}

/** Whether a review first saved on `recordedOn` came after the deadline */
export function isRecordedLate(deadlineOn: string | null, recordedOn: string): boolean {
  return deadlineOn !== null && recordedOn > deadlineOn;
}

/**
 * Deadlines the morning notice covers: today, and up to the next business day (so a deadline on
 * Monday is announced on Friday too). Unrecorded appointments due in this range get one notice.
 */
export function noticeWindow(today: string): { from: string; to: string } {
  return { from: today, to: addBusinessDays(today, 1) };
}
