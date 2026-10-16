/**
 * Tell a member that a lead was assigned to them (#135): in-app and by email.
 * Failures are logged and never undo the assignment.
 */
import type { NotificationType } from '@/lib/db/schema';
import { filterAllowedRecipients } from '@/lib/email/allowed-recipients';
import { isEmailConfigured, sendEmail } from '@/lib/features/email';
import {
  createNotification,
  getOrCreatePreferences,
  shouldSendInAppNotification,
} from '@/lib/features/notifications/notification-service';

export interface LeadAssignedNotification {
  organizationId: string;
  leadId: string;
  leadName: string | null;
  company: string | null;
  assignee: { userId: string; email: string; name: string | null };
  /** Who assigned it (shown in the message) */
  assignedByName: string | null;
}

/**
 * Whether the member wants to hear about a notification type, from their own setting for the
 * organization (自分が担当に割り当てられたとき for assignments, #164). When the setting cannot
 * be read, the notification goes out.
 */
async function wantsNotification(
  userId: string,
  organizationId: string,
  type: NotificationType
): Promise<boolean> {
  try {
    const prefs = await getOrCreatePreferences(userId, organizationId);
    return shouldSendInAppNotification(type, prefs);
  } catch (error) {
    console.error('Notification preference could not be read:', error);
    return true;
  }
}

export function buildAssignmentMessage(
  n: LeadAssignedNotification,
  appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
) {
  const who = [n.company, n.leadName ? `${n.leadName} 様` : null].filter(Boolean).join(' ');
  const target = who || 'リード';
  const title = `【担当割り当て】${target} の担当になりました`;
  const by = n.assignedByName ? `${n.assignedByName} さんが` : '';
  const message = `${by}${target} の担当にあなたを割り当てました。リードを開いて対応を始めてください。`;
  const leadUrl = `${appUrl}/ja/leads/${n.leadId}`;
  return { title, message, leadUrl };
}

/**
 * In-app notification to some members only (the intake members of a consultation request).
 * Each one is created on its own, so one failure does not stop the others.
 */
export async function notifyUsersInApp(
  userIds: string[],
  organizationId: string,
  type: NotificationType,
  title: string,
  message: string,
  data?: Record<string, unknown>
): Promise<void> {
  // Each member's own setting for the type applies, as for notifyOrganizationMembers
  const results = await Promise.allSettled(
    userIds.map(async (userId) => {
      if (!(await wantsNotification(userId, organizationId, type))) return;
      await createNotification({ userId, organizationId, type, title, message, data });
    })
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('In-app notification failed:', result.reason);
    }
  }
}

/**
 * The member's setting 自分が担当に割り当てられたとき covers both channels: there is no separate
 * email setting for assignments, so turning it off stops the email too.
 */
export async function notifyLeadAssigned(n: LeadAssignedNotification): Promise<void> {
  if (!(await wantsNotification(n.assignee.userId, n.organizationId, 'lead_assigned'))) return;
  const { title, message, leadUrl } = buildAssignmentMessage(n);
  const tasks: Promise<unknown>[] = [
    createNotification({
      userId: n.assignee.userId,
      organizationId: n.organizationId,
      type: 'lead_assigned',
      title,
      message,
      data: { leadId: n.leadId },
    }),
  ];

  if (isEmailConfigured()) {
    // In test mode only company addresses are mailed
    const to = filterAllowedRecipients([n.assignee.email]);
    if (to.length > 0) {
      tasks.push(
        sendEmail({
          to,
          subject: title,
          text: `${message}\n\nリード: ${leadUrl}`,
          html: `<p>${escapeHtml(message)}</p><p><a href="${escapeHtml(leadUrl)}">リードを開く</a></p>`,
        })
      );
    }
  }

  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Lead assignment notification failed:', result.reason);
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
