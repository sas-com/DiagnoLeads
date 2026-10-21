/**
 * Lead Handoff tRPC Router (Refs #86)
 *
 * Anyone who can read leads may open a handoff sheet and see who receives them; choosing the
 * recipients needs permission to update settings (owner / admin), and only members who can be
 * assigned leads can be chosen.
 */

import type { AppAbility } from '@/lib/auth/permissions';
import { auditLogs } from '@/lib/db/schema';
import { listAssignableMembers } from '@/lib/features/leads/assignment';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { getHandoffHeader } from '../service';
import { getHandoffUserIds, setHandoffUserIds } from '../settings';
import {
  handoffSettingsSchema,
  leadScopeSchema,
  setHandoffRecipientsSchema,
} from '../types/schemas';

function assertCanRead(ability: AppAbility) {
  if (!ability.can('read', 'Lead')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to read leads' });
  }
}

export const leadHandoffRouter = router({
  get: organizationProcedure.input(leadScopeSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx.ability);
    const header = await getHandoffHeader(ctx.db, {
      organizationId: ctx.organization.id,
      leadId: input.leadId,
    });
    if (!header) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
    return header;
  }),

  recipients: organizationProcedure.input(handoffSettingsSchema).query(async ({ ctx }) => {
    assertCanRead(ctx.ability);
    const [ids, members] = await Promise.all([
      getHandoffUserIds(ctx.db, ctx.organization.id),
      listAssignableMembers(ctx.db, ctx.organization.id),
    ]);
    const memberIds = new Set(members.map((member) => member.userId));
    return {
      // Members who left or became read-only are not shown (nor told)
      userIds: ids.filter((id) => memberIds.has(id)),
      canEdit: ctx.ability.can('update', 'Settings'),
    };
  }),

  setRecipients: organizationProcedure
    .input(setHandoffRecipientsSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.ability.can('update', 'Settings')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to change the settings',
        });
      }
      const userIds = [...new Set(input.userIds)];
      const members = await listAssignableMembers(ctx.db, ctx.organization.id);
      const memberIds = new Set(members.map((member) => member.userId));
      if (userIds.some((id) => !memberIds.has(id))) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only members who can be assigned leads can receive handoff sheets',
        });
      }
      const before = await getHandoffUserIds(ctx.db, ctx.organization.id);
      await setHandoffUserIds(ctx.db, ctx.organization.id, userIds);
      await ctx.db.insert(auditLogs).values({
        organizationId: ctx.organization.id,
        userId: ctx.user.id,
        action: 'update',
        resource: 'organization',
        resourceId: ctx.organization.id,
        changes: { before: { leadHandoffUserIds: before }, after: { leadHandoffUserIds: userIds } },
      });
      return { userIds };
    }),
});
