/**
 * The clock of the office (#1120): the hour in the time zone the app shows, and whether the
 * office is in its night. The admin screens follow the theme (light is day, dark is night); the
 * clock only tells the real time of day beside it.
 */

/** The hour (0 to 23) of an instant in a time zone */
export function hourIn(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone })
    .formatToParts(now)
    .find((part) => part.type === 'hour');
  return Number(hour?.value ?? 0);
}

/** Night falls at 18:00 and ends at 6:00 */
export function isNightHour(hour: number): boolean {
  return hour < 6 || hour >= 18;
}
