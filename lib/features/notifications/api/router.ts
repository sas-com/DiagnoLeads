/**
 * Notifications tRPC Router
 */
import { organizationProcedure, protectedProcedure, router } from '@/lib/trpc/init';
import { z } from 'zod';
import {
  NOTIFICATION_PREFERENCE_KEYS,
  type NotificationPreferenceKey,
  deleteNotification,
  getOrCreatePreferences,
  getUnreadCount,
  getUserNotifications,
  markAllAsRead,
  markAsRead,
  pickPreferenceUpdates,
  updatePreferences,
} from '../notification-service';

const preferenceSwitches = Object.fromEntries(
  NOTIFICATION_PREFERENCE_KEYS.map((key) => [key, z.boolean().optional()])
) as Record<NotificationPreferenceKey, z.ZodOptional<z.ZodBoolean>>;

export const notificationsRouter = router({
  /**
   * List notifications for current user
   */
  list: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        unreadOnly: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const notifications = await getUserNotifications(ctx.session.user.id, input.organizationId, {
        limit: input.limit,
        unreadOnly: input.unreadOnly,
      });

      return notifications;
    }),

  /**
   * Get unread count
   */
  unreadCount: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const count = await getUnreadCount(ctx.session.user.id, input.organizationId);
      return { count };
    }),

  /**
   * Mark notification as read
   */
  markAsRead: protectedProcedure
    .input(
      z.object({
        notificationId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await markAsRead(input.notificationId, ctx.session.user.id);
      return { success: true };
    }),

  /**
   * Mark all notifications as read
   */
  markAllAsRead: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await markAllAsRead(ctx.session.user.id, input.organizationId);
      return { success: true };
    }),

  /**
   * Delete notification
   */
  delete: protectedProcedure
    .input(
      z.object({
        notificationId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await deleteNotification(input.notificationId, ctx.session.user.id);
      return { success: true };
    }),

  /**
   * Get notification preferences (per user and organization; members only)
   */
  getPreferences: organizationProcedure.query(async ({ ctx, input }) => {
    const prefs = await getOrCreatePreferences(ctx.session.user.id, input.organizationId, ctx.db);
    return prefs;
  }),

  /**
   * Update notification preferences (members only)
   */
  updatePreferences: organizationProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        ...preferenceSwitches,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // The switches by name: input also carries keys the schema does not declare (#743)
      const updates = pickPreferenceUpdates(input);
      const prefs = await updatePreferences(
        ctx.session.user.id,
        input.organizationId,
        updates,
        ctx.db
      );
      return prefs;
    }),
});
