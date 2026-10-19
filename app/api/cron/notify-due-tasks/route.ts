import { isCronRequest } from '@/lib/cron/authorize';
import { db } from '@/lib/db/client';
import { recomputeRecentlyUpdated } from '@/lib/features/act-timing/service';
import { runAppointmentReviewNotices } from '@/lib/features/appointment-reviews/service';
import { runDueTaskNotifications } from '@/lib/features/lead-follow-up/due-notifications';
import { reportServerError } from '@/lib/ops/alert';
import { NextResponse } from 'next/server';

/**
 * Due notices of next actions and takeaways (#85), and of appointment reviews due (#149).
 * First the "when to act" of recently updated leads is recomputed (#151), so its next actions
 * exist before the notices are sent.
 * vercel.json runs this daily at 23:00 UTC (08:00 JST); running it again the same day sends
 * nothing new.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Never stops the notices: what fails here is caught up by the next run
  const actTiming = await recomputeRecentlyUpdated(db).catch(async (error: unknown) => {
    console.error('When to act recompute failed:', error);
    await reportServerError('cron/act-timing', error);
    return { error: 'failed' };
  });
  const result = await runDueTaskNotifications(db).catch(async (error: unknown) => {
    await reportServerError('cron/notify-due-tasks', error);
    throw error;
  });
  // A failure of one kind of notice must not stop the other
  const appointmentReviews = await runAppointmentReviewNotices(db).catch(async (error: unknown) => {
    console.error('Appointment review notices failed:', error);
    await reportServerError('cron/appointment-review-notices', error);
    return { error: 'failed' };
  });
  return NextResponse.json({ ...result, appointmentReviews, actTiming });
}
