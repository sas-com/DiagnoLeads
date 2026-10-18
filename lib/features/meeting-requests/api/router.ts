/**
 * Meeting Requests tRPC Router (Refs #155)
 *
 * Anyone who can read leads may see the respondent's preferred dates (including viewers from a
 * parent organization); confirming one needs permission to update leads. Every query is scoped
 * by organizationId (see ../service.ts).
 */

import type { AppAbility } from '@/lib/auth/permissions';
import { isEmailConfigured } from '@/lib/features/email';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { confirmMeeting, getMeetingRequest } from '../service';
import { confirmMeetingSchema, leadScopeSchema } from '../types/schemas';

function assertCan(ability: AppAbility, action: 'read' | 'update') {
  if (!ability.can(action, 'Lead')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `You do not have permission to ${action} meeting requests`,
    });
  }
}

export const meetingRequestsRouter = router({
  get: organizationProcedure.input(leadScopeSchema).query(async ({ ctx, input }) => {
    assertCan(ctx.ability, 'read');
    const request = await getMeetingRequest(ctx.db, {
      organizationId: ctx.organization.id,
      leadId: input.leadId,
    });
    return {
      request,
      canEdit: ctx.ability.can('update', 'Lead'),
      emailConfigured: isEmailConfigured(),
    };
  }),

  confirm: organizationProcedure.input(confirmMeetingSchema).mutation(async ({ ctx, input }) => {
    assertCan(ctx.ability, 'update');
    const outcome = await confirmMeeting(ctx.db, {
      ...input,
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
    });
    if (!outcome.ok) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting request not found' });
    }
    return outcome;
  }),
});
