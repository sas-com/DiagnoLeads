import { isCronRequest } from '@/lib/cron/authorize';
import { db } from '@/lib/db/client';
import { runAppointmentReviewNotices } from '@/lib/features/appointment-reviews/service';
import { runDueTaskNotifications } from '@/lib/features/lead-follow-up/due-notifications';
import { NextResponse } from 'next/server';

/**
 * Due notices of next actions and takeaways (#85), and of appointment reviews due (#149).
 * vercel.json runs this daily at 23:00 UTC (08:00 JST); running it again the same day sends
 * nothing new.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runDueTaskNotifications(db);
  // A failure of one kind of notice must not stop the other
  const appointmentReviews = await runAppointmentReviewNotices(db).catch((error: unknown) => {
    console.error('Appointment review notices failed:', error);
    return { error: 'failed' };
  });
  return NextResponse.json({ ...result, appointmentReviews });
}
