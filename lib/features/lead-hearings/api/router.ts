/**
 * Lead Hearings tRPC Router (Refs #84)
 *
 * Anyone who can read leads may read hearings (including viewers from a parent organization);
 * creating, changing and deleting need permission to update leads. Every query is scoped by
 * organizationId (see ../service.ts).
 */

import type { AppAbility } from '@/lib/auth/permissions';
import { auditLogs } from '@/lib/db/schema';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { HEARING_BASE_CATALOG, resolveHearingCatalog } from '../catalog';
import {
  createLeadHearing,
  deleteLeadHearing,
  getLeadHearing,
  getLeadHearingSummarySource,
  listLeadHearings,
  listPrefillSources,
  updateLeadHearing,
} from '../service';
import {
  getHearingOverrides,
  getHearingSettings,
  hearingSettingsSchema,
  saveHearingSettings,
} from '../settings';
import { buildHearingSummary } from '../summary';
import { hearingSummaryLabels } from '../summary-messages';
import {
  createLeadHearingSchema,
  deleteLeadHearingSchema,
  getLeadHearingSchema,
  hearingCatalogSettingsSchema,
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
  /**
   * The organization's hearing settings (#98): which fields are asked, their order and which are
   * required. Everyone who reads hearings gets them (the screens follow them); owners and admins
   * change them.
   */
  catalogSettings: organizationProcedure
    .input(hearingCatalogSettingsSchema)
    .query(async ({ ctx }) => {
      assertCanRead(ctx.ability);
      return {
        settings: await getHearingSettings(ctx.db, ctx.organization.id),
        canEdit: ctx.ability.can('update', 'Settings'),
      };
    }),

  updateCatalogSettings: organizationProcedure
    .input(z.object({ organizationId: z.string().uuid(), settings: hearingSettingsSchema }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.ability.can('update', 'Settings')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to change the hearing settings',
        });
      }
      const before = await getHearingSettings(ctx.db, ctx.organization.id);
      const version = await saveHearingSettings(
        ctx.db,
        ctx.organization.id,
        input.settings,
        before.version
      );
      // The version of each change is kept in the audit log with what changed
      await ctx.db.insert(auditLogs).values({
        organizationId: ctx.organization.id,
        userId: ctx.user.id,
        action: 'update',
        resource: 'organization',
        resourceId: ctx.organization.id,
        changes: {
          before: { hearingCatalog: before },
          after: { hearingCatalog: { ...input.settings, version } },
        },
      });
      return { version };
    }),

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
    // The organization's catalog (#98); hidden fields this record has a value for still show
    const overrides = await getHearingOverrides(ctx.db, ctx.organization.id);
    const catalog = resolveHearingCatalog(HEARING_BASE_CATALOG, {
      ...overrides,
      show: Object.keys(source.fields),
    });
    const summary = buildHearingSummary(
      { heldOn: source.heldOn, fields: source.fields, lead: source.lead },
      catalog,
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
