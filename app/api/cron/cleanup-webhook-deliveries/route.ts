import { isCronRequest } from '@/lib/cron/authorize';
import { db } from '@/lib/db/client';
import { maintainSiteVisits } from '@/lib/features/site-visits/maintenance';
import {
  cleanupOldDeliveries,
  processWebhookRetries,
} from '@/lib/features/webhooks/services/webhook-service';
import { reportServerError } from '@/lib/ops/alert';
import { NextResponse } from 'next/server';

/** Webhook deliveries kept for this many days (vercel.json runs this daily) */
const DAYS_TO_KEEP = 30;

/**
 * Daily webhook maintenance (vercel.json, 03:00 UTC): sends the deliveries due for retry
 * (failed attempts and attempts cut off mid-way), then deletes old finished deliveries.
 * Retries share this cron instead of having their own, as the plan may allow daily crons only.
 * The daily totals and retention of the site visits (#412) share it for the same reason.
 * Each step runs even if the others fail; a failure is reported and the response is a 500.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const [retries, cleanup, siteVisits] = await Promise.allSettled([
    processWebhookRetries().catch(async (error: unknown) => {
      await reportServerError('cron/webhook-retries', error);
      throw error;
    }),
    cleanupOldDeliveries(DAYS_TO_KEEP).catch(async (error: unknown) => {
      await reportServerError('cron/cleanup-webhook-deliveries', error);
      throw error;
    }),
    maintainSiteVisits(db).catch(async (error: unknown) => {
      await reportServerError('cron/site-visits', error);
      throw error;
    }),
  ]);
  if (retries.status === 'rejected') throw retries.reason;
  if (cleanup.status === 'rejected') throw cleanup.reason;
  if (siteVisits.status === 'rejected') throw siteVisits.reason;
  return NextResponse.json({
    deleted: cleanup.value,
    retries: retries.value,
    siteVisits: siteVisits.value,
  });
}
