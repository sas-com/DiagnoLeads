import { isCronRequest } from '@/lib/cron/authorize';
import { db } from '@/lib/db/client';
import { runDueTaskNotifications } from '@/lib/features/lead-follow-up/due-notifications';
import { NextResponse } from 'next/server';

/**
 * Due notices of next actions and takeaways (#85). vercel.json runs this daily at 23:00 UTC
 * (08:00 JST); running it again the same day sends nothing new.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runDueTaskNotifications(db);
  return NextResponse.json(result);
}
