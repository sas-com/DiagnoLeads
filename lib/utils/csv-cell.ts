/**
 * One CSV cell: quoted when needed, and a leading = + - @ (or tab / CR) is prefixed with ' so
 * a spreadsheet does not run it as a formula (CSV injection). The one guard of every CSV the
 * app writes: the lead exports (lib/features/leads/export.ts, #173, #996) and the analytics
 * report (lib/features/reports/export-service.ts, #1020). Text cells only: a negative number
 * would become text.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
