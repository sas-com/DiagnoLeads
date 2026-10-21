/**
 * Delivery Reviews tRPC Router (Refs #159)
 *
 * Anyone who can read leads may read a review and the report; saving needs permission to update
 * leads, and viewers from a parent organization only read.
 */

import type { AppAbility } from '@/lib/auth/permissions';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { getDeliveryReport, getDeliveryReview, saveDeliveryReview } from '../service';
import { deliveryReportSchema, leadScopeSchema, saveDeliveryReviewSchema } from '../types/schemas';

type Ctx = { ability: AppAbility; membership: { role: string } };

const canEdit = (ctx: Ctx) =>
  ctx.ability.can('update', 'Lead') && ctx.membership.role !== 'parent_viewer';

function assertCanRead(ctx: Ctx) {
  if (!ctx.ability.can('read', 'Lead')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to read delivery reviews',
    });
  }
}

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });

export const deliveryReviewsRouter = router({
  get: organizationProcedure.input(leadScopeSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx);
    const found = await getDeliveryReview(ctx.db, {
      organizationId: ctx.organization.id,
      leadId: input.leadId,
    });
    if (!found) throw notFound();
    return { ...found, canEdit: canEdit(ctx) };
  }),

  save: organizationProcedure.input(saveDeliveryReviewSchema).mutation(async ({ ctx, input }) => {
    if (!canEdit(ctx)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to update delivery reviews',
      });
    }
    const saved = await saveDeliveryReview(ctx.db, {
      organizationId: ctx.organization.id,
      leadId: input.leadId,
      userId: ctx.user.id,
      review: input.review,
    });
    if (!saved) throw notFound();
    return { ok: true };
  }),

  report: organizationProcedure.input(deliveryReportSchema).query(async ({ ctx }) => {
    assertCanRead(ctx);
    return getDeliveryReport(ctx.db, ctx.organization.id);
  }),
});
