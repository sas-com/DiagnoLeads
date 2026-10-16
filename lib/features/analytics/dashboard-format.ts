/**
 * Display helpers for the dashboard. Every date is a Japan calendar day written as M/D, whatever
 * the browser's time zone.
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant shifted so its UTC fields read as Japan local time */
function jst(instant: Date): Date {
  return new Date(instant.getTime() + JST_OFFSET_MS);
}

/** Japan calendar day (YYYY-MM-DD) of an instant */
export function jstDate(instant: Date): string {
  return jst(instant).toISOString().slice(0, 10);
}

/** "2026-09-29" or "2026/09/29" → "9/29" */
export function shortDay(day: string): string {
  const [, month, date] = day.split(/[-/]/).map(Number);
  return `${month}/${date}`;
}

/** M/D of an instant on the Japan calendar */
export function jstShortDay(instant: Date): string {
  return shortDay(jstDate(instant));
}

/** First and last day (M/D) of a period of `days` Japan calendar days ending today */
export function periodRange(days: number, now: Date = new Date()) {
  const todayStart = new Date(`${jstDate(now)}T00:00:00+09:00`);
  const from = new Date(todayStart.getTime() - (days - 1) * DAY_MS);
  return { from: jstShortDay(from), to: jstShortDay(now) };
}

export type ReceivedAt =
  | { kind: 'today'; time: string }
  | { kind: 'yesterday' }
  | { kind: 'date'; date: string };

/** When a lead came in: "today 11:20", "yesterday", or M/D (Japan time) */
export function receivedAt(instant: Date, now: Date = new Date()): ReceivedAt {
  const day = jstDate(instant);
  if (day === jstDate(now)) {
    return { kind: 'today', time: jst(instant).toISOString().slice(11, 16) };
  }
  if (day === jstDate(new Date(now.getTime() - DAY_MS))) return { kind: 'yesterday' };
  return { kind: 'date', date: shortDay(day) };
}

export type PeriodDelta = {
  delta: number;
  type: 'increase' | 'decrease' | 'unchanged';
  /** Change in percent; null when the previous period had nothing to compare with */
  rate: number | null;
};

/** Change from the previous period of the same length */
export function periodDelta(current: number, previous: number): PeriodDelta {
  const delta = current - previous;
  return {
    delta,
    type: delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'unchanged',
    rate: previous > 0 ? Math.round((delta / previous) * 100) : null,
  };
}

/** +22 / −3 / ±0 (a real minus sign, so it reads the same width as the plus) */
export function signed(value: number, format: (value: number) => string = String): string {
  if (value > 0) return `+${format(value)}`;
  if (value < 0) return `−${format(-value)}`;
  return `±${format(0)}`;
}
