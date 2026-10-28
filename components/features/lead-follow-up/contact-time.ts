/**
 * The time of a contact record on the screen (#554). Times are entered and shown in Japan's time,
 * whatever the browser's time zone, like the rest of the admin screens.
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** The value of a datetime-local input for a moment, in Japan ("2026-10-25T14:30") */
export function toJstInputValue(date: Date): string {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 16);
}

/** The moment a datetime-local value means in Japan; null when it is not a whole time */
export function fromJstInputValue(value: string): Date | null {
  if (!INPUT_PATTERN.test(value)) return null;
  const date = new Date(`${value}:00+09:00`);
  return Number.isNaN(date.getTime()) || toJstInputValue(date) !== value ? null : date;
}
