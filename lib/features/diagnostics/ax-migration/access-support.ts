/**
 * Support status of the Access / Office versions in use, shared by the evaluation (urgency
 * reason `access_support_ended`) and the column the result recommends (#363), so the two never
 * disagree. No other imports: the result screen (a client component) uses it.
 */

/**
 * End of support of the Access / Office versions (Microsoft lifecycle, checked 2026-10-11).
 * Statuses are computed from these dates, so the result never goes stale.
 */
const ACCESS_SUPPORT_END: Record<string, string | null> = {
  le2013: '2023-04-11',
  v2016_2019: '2025-10-14',
  v2021: '2026-10-13',
  v2024: '2029-10-09',
  m365: null,
};
const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * DAY_MS;

export type AccessSupport = 'ended' | 'ending' | 'v2024' | 'm365' | 'unknown';

/** The weakest support among the versions in use */
export function accessSupport(versions: string[], now: Date): AccessSupport | undefined {
  if (versions.length === 0) return undefined;
  if (versions.includes('unknown')) return 'unknown';
  let worst: AccessSupport = 'm365';
  const rank: Record<AccessSupport, number> = {
    ended: 4,
    ending: 3,
    v2024: 2,
    unknown: 1,
    m365: 0,
  };
  for (const version of versions) {
    const end = ACCESS_SUPPORT_END[version];
    let status: AccessSupport = version === 'v2024' ? 'v2024' : 'm365';
    if (end) {
      // Microsoft still ships updates on the end date, so support ends when that day is over
      const remaining = new Date(`${end}T00:00:00+09:00`).getTime() + DAY_MS - now.getTime();
      if (remaining <= 0) status = 'ended';
      else if (remaining <= YEAR_MS) status = 'ending';
    }
    if (rank[status] > rank[worst]) worst = status;
  }
  return worst;
}
