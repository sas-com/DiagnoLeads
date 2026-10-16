/**
 * Agency Contracts tRPC Router (Refs #148)
 *
 * Contracts hold the fees agreed with each sales agency, so only those who can update settings
 * (owner / admin) may see and change them. The report (funnel and cost per contract) is for
 * everyone who can read leads, except viewers from a parent organization. Every query is
 * scoped by organizationId.
 */

import type { AppAbility } from '@/lib/auth/permissions';
import { agencyContracts } from '@/lib/db/schema';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { termsOverlap } from '../report';
import { getAgencyContractReport, listContractTerms } from '../service';
import {
  type AgencyContractFields,
  agencyContractReportSchema,
  createAgencyContractSchema,
  deleteAgencyContractSchema,
  listAgencyContractsSchema,
  updateAgencyContractSchema,
} from '../types/schemas';

const REPORT_EXCLUDED_ROLES: readonly string[] = ['parent_viewer'];

type Ctx = { ability: AppAbility; membership: { role: string } };

function assertCanManage(ctx: Ctx) {
  if (!ctx.ability.can('update', 'Settings')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to manage agency contracts',
    });
  }
}

/** One contract per agency and day: overlapping terms would count the same lead twice */
async function assertNoOverlap(
  database: Parameters<typeof listContractTerms>[0],
  organizationId: string,
  contract: AgencyContractFields,
  exceptId?: string
) {
  const existing = await listContractTerms(database, organizationId);
  const clash = existing.find(
    (other) =>
      other.id !== exceptId &&
      other.agencyName.trim() === contract.agencyName &&
      termsOverlap(other, contract)
  );
  if (clash) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Another contract of this agency covers part of the same term',
    });
  }
}

export const agencyContractsRouter = router({
  list: organizationProcedure.input(listAgencyContractsSchema).query(async ({ ctx }) => {
    assertCanManage(ctx);
    return listContractTerms(ctx.db, ctx.organization.id);
  }),

  create: organizationProcedure
    .input(createAgencyContractSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx);
      await assertNoOverlap(ctx.db, ctx.organization.id, input.contract);
      const [created] = await ctx.db
        .insert(agencyContracts)
        .values({
          ...input.contract,
          organizationId: ctx.organization.id,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning({ id: agencyContracts.id });
      return created;
    }),

  update: organizationProcedure
    .input(updateAgencyContractSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx);
      await assertNoOverlap(ctx.db, ctx.organization.id, input.contract, input.id);
      const [updated] = await ctx.db
        .update(agencyContracts)
        .set({ ...input.contract, updatedBy: ctx.user.id, updatedAt: new Date() })
        .where(
          and(
            eq(agencyContracts.id, input.id),
            eq(agencyContracts.organizationId, ctx.organization.id)
          )
        )
        .returning({ id: agencyContracts.id });
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Contract not found' });
      return updated;
    }),

  remove: organizationProcedure
    .input(deleteAgencyContractSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx);
      const [removed] = await ctx.db
        .delete(agencyContracts)
        .where(
          and(
            eq(agencyContracts.id, input.id),
            eq(agencyContracts.organizationId, ctx.organization.id)
          )
        )
        .returning({ id: agencyContracts.id });
      if (!removed) throw new TRPCError({ code: 'NOT_FOUND', message: 'Contract not found' });
      return removed;
    }),

  report: organizationProcedure.input(agencyContractReportSchema).query(async ({ ctx }) => {
    if (!ctx.ability.can('read', 'Lead') || REPORT_EXCLUDED_ROLES.includes(ctx.membership.role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to read the agency report',
      });
    }
    return {
      ...(await getAgencyContractReport(ctx.db, ctx.organization.id)),
      canManage: ctx.ability.can('update', 'Settings'),
    };
  }),
});
