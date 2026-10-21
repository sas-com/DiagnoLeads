/**
 * Agency Handovers tRPC Router (Refs #152)
 *
 * Anyone who can read leads may read a lead's handover, except the contact person's name and
 * direct phone, which viewers from a parent organization do not get. Importing a report saves
 * those contact details (agency_handovers), so it needs permission to update leads (not viewers
 * from a parent organization).
 */

import type { AppAbility } from '@/lib/auth/permissions';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { getLeadHandover, importHandovers } from '../service';
import { importHandoversSchema, leadScopeSchema } from '../types/schemas';

type Ctx = { ability: AppAbility; membership: { role: string } };

const canImport = (ctx: Ctx) =>
  ctx.ability.can('update', 'Lead') && ctx.membership.role !== 'parent_viewer';

export const agencyHandoversRouter = router({
  get: organizationProcedure.input(leadScopeSchema).query(async ({ ctx, input }) => {
    if (!ctx.ability.can('read', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to read leads',
      });
    }
    const handover = await getLeadHandover(ctx.db, {
      organizationId: ctx.organization.id,
      leadId: input.leadId,
    });
    if (handover === undefined)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
    return {
      handover:
        handover && ctx.membership.role === 'parent_viewer'
          ? { ...handover, contactName: null, contactPhone: null }
          : handover,
    };
  }),

  import: organizationProcedure.input(importHandoversSchema).mutation(async ({ ctx, input }) => {
    if (!canImport(ctx)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to import agency reports',
      });
    }
    return importHandovers(ctx.db, {
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
      rows: input.rows,
    });
  }),
});
