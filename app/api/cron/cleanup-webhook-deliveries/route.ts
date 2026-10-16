import { isCronRequest } from '@/lib/cron/authorize';
import { cleanupOldDeliveries } from '@/lib/features/webhooks/services/webhook-service';
import { NextResponse } from 'next/server';

/** Webhook deliveries kept for this many days (vercel.json runs this daily) */
const DAYS_TO_KEEP = 30;

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const deleted = await cleanupOldDeliveries(DAYS_TO_KEEP);
  return NextResponse.json({ deleted });
}
