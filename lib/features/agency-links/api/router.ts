/**
 * Agency Links tRPC Router
 *
 * Sales issue a diagnosis link per agency (and campaign) and paste it into the agency's call
 * script; answers through an active link record the agency on the new lead (Refs #147).
 * Anyone who can read leads may list the links to copy them, except viewers from a parent
 * organization (agency deals are need-to-know); only those who can update settings may create
 * or disable them. Every query is scoped by organizationId.
 */

import { agencyLinks, leads } from '@/lib/db/schema';
import { resolveDiagnosisOrganizationId } from '@/lib/features/diagnostics/organization';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, ne } from 'drizzle-orm';
import {
  type AgencyLinkKind,
  MEMBER_REFERRAL_KIND,
  createAgencyLinkSchema,
  generateAgencyCode,
  listAgencyLinksSchema,
  setAgencyLinkActiveSchema,
} from '../types/schemas';

/** Roles that may not see the links even though they can read leads */
const LINK_READ_EXCLUDED_ROLES: readonly string[] = ['parent_viewer'];

export const agencyLinksRouter = router({
  /** Links of the organization, newest first, with the number of leads each one created */
  list: organizationProcedure.input(listAgencyLinksSchema).query(async ({ ctx }) => {
    if (
      !ctx.ability.can('read', 'Lead') ||
      LINK_READ_EXCLUDED_ROLES.includes(ctx.membership.role)
    ) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to read agency links',
      });
    }

    const rows = await ctx.db
      .select({
        id: agencyLinks.id,
        code: agencyLinks.code,
        agencyName: agencyLinks.agencyName,
        kind: agencyLinks.kind,
        campaign: agencyLinks.campaign,
        disabledAt: agencyLinks.disabledAt,
        createdAt: agencyLinks.createdAt,
        leadCount: count(leads.id),
      })
      .from(agencyLinks)
      .leftJoin(
        leads,
        and(eq(leads.agencyLinkId, agencyLinks.id), eq(leads.organizationId, ctx.organization.id))
      )
      // Employees' own links (#265) are theirs: other members must not see their codes here
      .where(
        and(
          eq(agencyLinks.organizationId, ctx.organization.id),
          ne(agencyLinks.kind, MEMBER_REFERRAL_KIND)
        )
      )
      .groupBy(agencyLinks.id)
      .orderBy(desc(agencyLinks.createdAt));

    return {
      links: rows.map((row) => ({ ...row, kind: row.kind as AgencyLinkKind })),
      canManage: ctx.ability.can('update', 'Settings'),
      // The public diagnosis saves answers into one organization only; links of any other
      // organization never match, so the screen warns about it
      receivesDiagnoses: resolveDiagnosisOrganizationId() === ctx.organization.id,
    };
  }),

  create: organizationProcedure.input(createAgencyLinkSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.ability.can('update', 'Settings')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to create agency links',
      });
    }

    // A collision of two random 12-letter codes is not worth a retry loop: the unique
    // constraint turns it into an error the user can simply retry
    const [link] = await ctx.db
      .insert(agencyLinks)
      .values({
        organizationId: ctx.organization.id,
        code: generateAgencyCode(),
        agencyName: input.agencyName,
        kind: input.kind,
        campaign: input.campaign ?? null,
        createdBy: ctx.user.id,
      })
      .returning({ id: agencyLinks.id, code: agencyLinks.code });

    return link;
  }),

  /**
   * Disable or re-enable a link. A disabled link still opens the diagnosis (the agency may have
   * sent it already), but answers through it are no longer attributed to the agency.
   */
  setActive: organizationProcedure
    .input(setAgencyLinkActiveSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.ability.can('update', 'Settings')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to change agency links',
        });
      }

      const [link] = await ctx.db
        .update(agencyLinks)
        .set({ disabledAt: input.active ? null : new Date() })
        .where(
          and(eq(agencyLinks.id, input.id), eq(agencyLinks.organizationId, ctx.organization.id))
        )
        .returning({ id: agencyLinks.id, disabledAt: agencyLinks.disabledAt });

      if (!link) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agency link not found' });
      }
      return link;
    }),
});
