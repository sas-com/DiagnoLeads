/**
 * Sales targets tRPC router (Refs #437)
 *
 * Those who may read deals may read the targets (not a parent organization's viewer); setting
 * them and the month the fiscal year starts needs permission to update the settings (owner /
 * admin). Anyone else gets only the organization's and their own targets (owner decision
 * 2026-10-24). Every query is scoped by organizationId (see ../service.ts).
 */

import { canReadDeals } from '@/lib/features/deals/access';
import { listAssignableMembers, memberDisplayName } from '@/lib/features/leads/assignment';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { fiscalYearOf, fiscalYearRange } from '../fiscal-year';
import {
  getFiscalYearStartMonth,
  listFormerTargetHolders,
  listTargets,
  saveTargets,
  setFiscalYearStartMonth,
} from '../service';
import { fiscalYearStartSchema, saveTargetsSchema, targetsQuerySchema } from '../types/schemas';

export const salesTargetsRouter = router({
  /** The targets of a fiscal year, by month, for the organization and each member */
  get: organizationProcedure.input(targetsQuerySchema).query(async ({ ctx, input }) => {
    if (!canReadDeals(ctx)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to read targets',
      });
    }
    const canEdit = ctx.ability.can('update', 'Settings');
    const organizationId = ctx.organization.id;
    const startMonth = await getFiscalYearStartMonth(ctx.db, organizationId);
    const [year, month] = jstDate().split('-').map(Number);
    const fiscalYear = input.fiscalYear ?? fiscalYearOf(year, month, startMonth);
    const range = fiscalYearRange(fiscalYear, startMonth);
    const [allTargets, members] = await Promise.all([
      listTargets(ctx.db, { organizationId, months: range.months }),
      canEdit ? listAssignableMembers(ctx.db, organizationId) : Promise.resolve([]),
    ]);
    const targets = canEdit
      ? allTargets
      : allTargets.filter((target) => target.userId === null || target.userId === ctx.user.id);
    const formerMembers = canEdit
      ? await listFormerTargetHolders(
          ctx.db,
          targets,
          new Set(members.map((member) => member.userId))
        )
      : [];
    return {
      fiscalYear,
      fiscalYearStartMonth: startMonth,
      months: range.months,
      members: members.map((member) => ({
        userId: member.userId,
        displayName: memberDisplayName(member),
      })),
      /** Hold a target but can no longer hold leads: their targets can only be removed */
      formerMembers: formerMembers.map((holder) => ({
        userId: holder.userId,
        displayName: holder.name,
      })),
      targets,
      canEdit,
    };
  }),

  save: organizationProcedure.input(saveTargetsSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.ability.can('update', 'Settings')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to set targets',
      });
    }
    return saveTargets(ctx.db, {
      ...input,
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
    });
  }),

  setFiscalYearStart: organizationProcedure
    .input(fiscalYearStartSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.ability.can('update', 'Settings')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to change the fiscal year',
        });
      }
      await setFiscalYearStartMonth(ctx.db, {
        organizationId: ctx.organization.id,
        month: input.month,
        userId: ctx.user.id,
      });
      return { fiscalYearStartMonth: input.month };
    }),
});
