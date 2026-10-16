import type { db as defaultDb } from '@/lib/db/client';
import type { ResponseTimeData, ResponseTimeResult } from './types/schemas';

type Database = typeof defaultDb;

const HOUR_BUCKETS = [
  { min: 0, max: 1, label: '< 1 hour' },
  { min: 1, max: 24, label: '1-24 hours' },
  { min: 24, max: 72, label: '1-3 days' },
  { min: 72, max: Number.POSITIVE_INFINITY, label: '3+ days' },
] as const;

/** Distribution of response times (hours from lead creation to the first contact) */
export function bucketResponseTimes(hours: number[]): ResponseTimeData[] {
  const total = hours.length;
  return HOUR_BUCKETS.map((bucket) => {
    const inBucket = hours.filter((value) => value >= bucket.min && value < bucket.max);
    const averageHours =
      inBucket.length > 0 ? inBucket.reduce((a, b) => a + b, 0) / inBucket.length : 0;
    return {
      period: bucket.label,
      count: inBucket.length,
      percentage: total > 0 ? Math.round((inBucket.length / total) * 10000) / 100 : 0,
      averageHours: Math.round(averageHours * 10) / 10,
    };
  });
}

/**
 * Response time of the leads of the period.
 *
 * It used to be `updatedAt - createdAt`, which grows with every later edit, so it measured
 * nothing. The real measure is the time to the first contact (call / mail), which leads do not
 * record yet.
 *
 * TODO(#136): once leads carry the first-contact time, select the leads of the organization
 * created since `from` that have one, pass their hours (first contact - created) to
 * `bucketResponseTimes` and return `{ status: 'ready', distribution }`.
 */
export async function getResponseTimeDistribution(
  _db: Database,
  _organizationId: string,
  _from: Date | null
): Promise<ResponseTimeResult> {
  return { status: 'pending', reason: 'first_contact_not_recorded' };
}
