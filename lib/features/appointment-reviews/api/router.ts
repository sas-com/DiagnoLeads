/**
 * Appointment Reviews tRPC Router (Refs #149)
 *
 * Anyone who can read leads may read a review (the contract fees are never part of it, only the
 * conditions and the deadline rule); recording needs permission to update leads. Every query is
 * scoped by organizationId (see ../service.ts).
 */

import type { AppAbility } from '@/lib/auth/permissions';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { getAppointmentReviewContext, saveAppointmentReview } from '../service';
import { leadScopeSchema, saveAppointmentReviewSchema } from '../types/schemas';

function assertCan(ability: AppAbility, action: 'read' | 'update') {
  if (!ability.can(action, 'Lead')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `You do not have permission to ${action} appointment reviews`,
    });
  }
}

export const appointmentReviewsRouter = router({
  get: organizationProcedure.input(leadScopeSchema).query(async ({ ctx, input }) => {
    assertCan(ctx.ability, 'read');
    const context = await getAppointmentReviewContext(ctx.db, {
      organizationId: ctx.organization.id,
      leadId: input.leadId,
    });
    if (!context) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
    return { ...context, canEdit: ctx.ability.can('update', 'Lead') };
  }),

  save: organizationProcedure
    .input(saveAppointmentReviewSchema)
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.ability, 'update');
      const saved = await saveAppointmentReview(ctx.db, {
        ...input,
        organizationId: ctx.organization.id,
        userId: ctx.user.id,
      });
      if (!saved) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead from a sales agency not found' });
      }
      return saved;
    }),
});
