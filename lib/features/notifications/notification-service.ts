/**
 * Notification Service
 *
 * Handles creating and managing notifications
 */
import { type Database, db } from '@/lib/db/client';
import {
  type NewNotification,
  type NotificationType,
  notificationPreferences,
  notifications,
} from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

/**
 * Create a notification for a user
 */
export async function createNotification(data: NewNotification): Promise<void> {
  await db.insert(notifications).values(data);
}

/**
 * Create notifications for all organization members
 */
export async function notifyOrganizationMembers(
  organizationId: string,
  type: NotificationType,
  title: string,
  message: string,
  data?: Record<string, unknown>
): Promise<void> {
  // Get all members of the organization
  const members = await db.query.organizationMembers.findMany({
    where: (members, { eq }) => eq(members.organizationId, organizationId),
    with: {
      user: true,
    },
  });

  // Check preferences and create notifications
  for (const member of members) {
    const prefs = await getOrCreatePreferences(member.userId, organizationId);

    // Check if user wants this notification type
    const shouldNotify = shouldSendInAppNotification(type, prefs);

    if (shouldNotify) {
      await createNotification({
        userId: member.userId,
        organizationId,
        type,
        title,
        message,
        data,
      });
    }
  }
}

/**
 * Get notifications for a user
 */
export async function getUserNotifications(
  userId: string,
  organizationId?: string,
  options: { limit?: number; unreadOnly?: boolean } = {}
) {
  const { limit = 20, unreadOnly = false } = options;

  const conditions = [eq(notifications.userId, userId)];

  if (organizationId) {
    conditions.push(eq(notifications.organizationId, organizationId));
  }

  if (unreadOnly) {
    conditions.push(eq(notifications.read, false));
  }

  return db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(userId: string, organizationId?: string): Promise<number> {
  const conditions = [eq(notifications.userId, userId), eq(notifications.read, false)];

  if (organizationId) {
    conditions.push(eq(notifications.organizationId, organizationId));
  }

  const result = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(...conditions));

  return result.length;
}

/**
 * Mark notification as read
 */
export async function markAsRead(notificationId: string, userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({
      read: true,
      readAt: new Date(),
    })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
}

/**
 * Mark all notifications as read
 */
export async function markAllAsRead(userId: string, organizationId?: string): Promise<void> {
  const conditions = [eq(notifications.userId, userId), eq(notifications.read, false)];

  if (organizationId) {
    conditions.push(eq(notifications.organizationId, organizationId));
  }

  await db
    .update(notifications)
    .set({
      read: true,
      readAt: new Date(),
    })
    .where(and(...conditions));
}

/**
 * Delete a notification
 */
export async function deleteNotification(notificationId: string, userId: string): Promise<void> {
  await db
    .delete(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
}

/**
 * Get or create notification preferences
 */
export async function getOrCreatePreferences(
  userId: string,
  organizationId: string,
  database: Database = db
) {
  const existing = await database.query.notificationPreferences.findFirst({
    where: and(
      eq(notificationPreferences.userId, userId),
      eq(notificationPreferences.organizationId, organizationId)
    ),
  });

  if (existing) {
    return existing;
  }

  // Create default preferences
  const [created] = await database
    .insert(notificationPreferences)
    .values({
      userId,
      organizationId,
    })
    .returning();

  return created;
}

/** The preference switches a user can change */
export const NOTIFICATION_PREFERENCE_KEYS = [
  'inAppLeadCreated',
  'inAppLeadStatusChanged',
  'inAppLeadScored',
  'inAppImportExport',
  'inAppMemberChanges',
  'emailLeadCreated',
  'emailLeadStatusChanged',
  'emailLeadScored',
  'emailDailyDigest',
  'emailWeeklyReport',
  'inAppConsultationRequested',
  'inAppAssignedToMe',
  'inAppNextActionDue',
  'inAppHearingNextMeeting',
] as const;

export type NotificationPreferenceKey = (typeof NOTIFICATION_PREFERENCE_KEYS)[number];
export type NotificationPreferenceUpdates = Partial<Record<NotificationPreferenceKey, boolean>>;

/**
 * The preference switches of `source`, read by name (#743). A procedure's input still carries
 * keys its schema does not declare (organizationInputSchema passes them through and tRPC merges
 * the parsed inputs), and drizzle writes every key that names a column: spreading the input let
 * a member set user_id, id or created_at of their row.
 */
export function pickPreferenceUpdates(
  source: Partial<Record<NotificationPreferenceKey, unknown>>
): NotificationPreferenceUpdates {
  const updates: NotificationPreferenceUpdates = {};
  for (const key of NOTIFICATION_PREFERENCE_KEYS) {
    const value = source[key];
    if (typeof value === 'boolean') updates[key] = value;
  }
  return updates;
}

/**
 * Update notification preferences. Only the switches are written, whatever else `updates`
 * carries (see pickPreferenceUpdates)
 */
export async function updatePreferences(
  userId: string,
  organizationId: string,
  updates: NotificationPreferenceUpdates,
  database: Database = db
) {
  await getOrCreatePreferences(userId, organizationId, database);

  const [updated] = await database
    .update(notificationPreferences)
    .set({
      ...pickPreferenceUpdates(updates),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.organizationId, organizationId)
      )
    )
    .returning();

  return updated;
}

/**
 * Check if user should receive in-app notification
 */
export function shouldSendInAppNotification(
  type: NotificationType,
  prefs: typeof notificationPreferences.$inferSelect
): boolean {
  switch (type) {
    case 'lead_created':
      return prefs.inAppLeadCreated;
    case 'lead_status_changed':
      return prefs.inAppLeadStatusChanged;
    case 'lead_scored':
      return prefs.inAppLeadScored;
    case 'import_completed':
    case 'export_completed':
      return prefs.inAppImportExport;
    case 'member_invited':
    case 'member_removed':
      return prefs.inAppMemberChanges;
    case 'consultation_requested':
    // A customer search row handed over to sales (#265) is a request to contact, like a consultation
    case 'prospect_handed_over':
      return prefs.inAppConsultationRequested;
    case 'lead_assigned':
      return prefs.inAppAssignedToMe;
    case 'next_action_due':
    // The deadline to report a failed appointment (#149) is a due date of the same setting
    case 'appointment_review_due':
      return prefs.inAppNextActionDue;
    // A restriction on AI source code analysis (#160) changes the plan: always told, like system
    case 'hearing_ai_restricted':
    // Handoff sheets (#86) go to the members the organization chose to receive them
    case 'lead_handoff':
    // The employee's own referral turned into a diagnosis (#265): addressed to that one person
    case 'referral_diagnosed':
    case 'system':
      return true;
    default:
      return true;
  }
}
