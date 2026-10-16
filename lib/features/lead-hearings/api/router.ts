/**
 * Lead Hearings tRPC Router (Refs #84)
 *
 * Anyone who can read leads may read hearings (including viewers from a parent organization);
 * creating, changing and deleting need permission to update leads. Every query is scoped by
 * organizationId (see ../service.ts).
 */

import type { AppAbility } from '@/lib/auth/permissions';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { DEFAULT_HEARING_CATALOG } from '../catalog';
import {
  createLeadHearing,
  deleteLeadHearing,
  getLeadHearing,
  getLeadHearingSummarySource,
  listLeadHearings,
  listPrefillSources,
  updateLeadHearing,
} from '../service';
import { buildHearingSummary } from '../summary';
import { hearingSummaryLabels } from '../summary-messages';
import {
  createLeadHearingSchema,
  deleteLeadHearingSchema,
  getLeadHearingSchema,
  leadHearingPrefillSourcesSchema,
  leadHearingSummarySchema,
  listLeadHearingsSchema,
  updateLeadHearingSchema,
} from '../types/schemas';

function assertCanRead(ability: AppAbility) {
  if (!ability.can('read', 'Lead')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to read hearings',
    });
  }
}

function assertCanWrite(ability: AppAbility) {
  if (!ability.can('update', 'Lead')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to change hearings',
    });
  }
}

export const leadHearingsRouter = router({
  /** Hearings of a lead, newest meeting first, with the count of open required items */
  listByLead: organizationProcedure.input(listLeadHearingsSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx.ability);
    const items = await listLeadHearings(ctx.db, {
      organizationId: ctx.organization.id,
      leadId: input.leadId,
    });
    return { items, canEdit: ctx.ability.can('update', 'Lead') };
  }),

  get: organizationProcedure.input(getLeadHearingSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx.ability);
    const hearing = await getLeadHearing(ctx.db, {
      organizationId: ctx.organization.id,
      id: input.id,
    });
    return { ...hearing, canEdit: ctx.ability.can('update', 'Lead') };
  }),

  /**
   * The meeting summary of a hearing (#97), compared with the previous hearing of the lead.
   * Read like get: same permission, same organization scope.
   */
  summary: organizationProcedure.input(leadHearingSummarySchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx.ability);
    const source = await getLeadHearingSummarySource(ctx.db, {
      organizationId: ctx.organization.id,
      id: input.id,
    });
    // Organization overrides (#98) will resolve their own catalog here
    const summary = buildHearingSummary(
      { heldOn: source.heldOn, fields: source.fields, lead: source.lead },
      DEFAULT_HEARING_CATALOG,
      hearingSummaryLabels(input.locale ?? 'ja'),
      source.previous
    );
    return {
      id: source.id,
      leadId: source.leadId,
      previousId: source.previous?.id ?? null,
      summary,
    };
  }),

  /** The lead's Web diagnosis submissions a new hearing can start from */
  prefillSources: organizationProcedure
    .input(leadHearingPrefillSourcesSchema)
    .query(async ({ ctx, input }) => {
      assertCanRead(ctx.ability);
      return listPrefillSources(ctx.db, {
        organizationId: ctx.organization.id,
        leadId: input.leadId,
      });
    }),

  create: organizationProcedure.input(createLeadHearingSchema).mutation(async ({ ctx, input }) => {
    assertCanWrite(ctx.ability);
    return createLeadHearing(ctx.db, {
      ...input,
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
    });
  }),

  /** Replace the date and all fields (expectedUpdatedAt guards against lost updates) */
  update: organizationProcedure.input(updateLeadHearingSchema).mutation(async ({ ctx, input }) => {
    assertCanWrite(ctx.ability);
    return updateLeadHearing(ctx.db, {
      ...input,
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
    });
  }),

  delete: organizationProcedure.input(deleteLeadHearingSchema).mutation(async ({ ctx, input }) => {
    assertCanWrite(ctx.ability);
    return deleteLeadHearing(ctx.db, { organizationId: ctx.organization.id, id: input.id });
  }),
});
