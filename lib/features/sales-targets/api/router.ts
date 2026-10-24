/**
 * Sales targets tRPC router (Refs #437)
 *
 * Anyone who can read leads may read the targets; setting them and the month the fiscal year
 * starts needs permission to update the settings (owner / admin). Every query is scoped by
 * organizationId (see ../service.ts).
 */

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
    if (!ctx.ability.can('read', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to read targets',
      });
    }
    const organizationId = ctx.organization.id;
    const startMonth = await getFiscalYearStartMonth(ctx.db, organizationId);
    const [year, month] = jstDate().split('-').map(Number);
    const fiscalYear = input.fiscalYear ?? fiscalYearOf(year, month, startMonth);
    const range = fiscalYearRange(fiscalYear, startMonth);
    const [targets, members] = await Promise.all([
      listTargets(ctx.db, { organizationId, months: range.months }),
      listAssignableMembers(ctx.db, organizationId),
    ]);
    const formerMembers = await listFormerTargetHolders(
      ctx.db,
      targets,
      new Set(members.map((member) => member.userId))
    );
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
      canEdit: ctx.ability.can('update', 'Settings'),
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
