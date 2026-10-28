/**
 * Lead activity tRPC router (Refs #101)
 *
 * Anyone who can read leads may read the timeline (including viewers from a parent
 * organization). Why an address was suppressed is shown only to those who can update settings
 * (#365), the comments only to those who may read them (#555: not the parent organization),
 * and which deal a contact was about only to those who may read deals (#554, #435). The
 * contact records of a deal (the deal page) need both. Every query is scoped by organizationId
 * and leadId or dealId, or by the user signed in (今日, #556) (see ../service.ts).
 */

import type { AppAbility } from '@/lib/auth/permissions';
import { canReadComments } from '@/lib/features/comments/service';
import { canReadDeals } from '@/lib/features/deals/service';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import {
  getSubmissionAnswers,
  listDealActivities,
  listLeadActivities,
  listMyContactsOfDay,
} from '../service';
import {
  getSubmissionAnswersSchema,
  listDealActivitiesSchema,
  listLeadActivitiesSchema,
  myDayActivitiesSchema,
} from '../types/schemas';

function assertCanRead(ability: AppAbility) {
  if (!ability.can('read', 'Lead')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to read the activity of leads',
    });
  }
}

export const leadActivityRouter = router({
  /** The lead's activity, newest first, one page at a time */
  list: organizationProcedure.input(listLeadActivitiesSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx.ability);
    return listLeadActivities(ctx.db, {
      organizationId: ctx.organization.id,
      leadId: input.leadId,
      types: input.types,
      limit: input.limit,
      cursor: input.cursor,
      showSuppressionReasons: ctx.ability.can('update', 'Settings'),
      hideComments: !canReadComments(ctx),
      hideDeals: !canReadDeals(ctx),
    });
  }),

  /** The contact records of a deal, newest first (the deal page, #554) */
  forDeal: organizationProcedure.input(listDealActivitiesSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx.ability);
    if (!canReadDeals(ctx)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to read the deals',
      });
    }
    const page = await listDealActivities(ctx.db, {
      organizationId: ctx.organization.id,
      dealId: input.dealId,
    });
    return { ...page, canEdit: ctx.ability.can('update', 'Lead') };
  }),

  /**
   * 今日 (#556): the contact records the user made today (Japan day), counted by kind with the
   * minutes they took. The user is the one signed in: the input names only the organization.
   * Which deal each was about stays hidden from those who may not read deals
   */
  myDay: organizationProcedure.input(myDayActivitiesSchema).query(async ({ ctx }) => {
    assertCanRead(ctx.ability);
    return listMyContactsOfDay(ctx.db, {
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
      day: jstDate(),
      hideDeals: !canReadDeals(ctx),
    });
  }),

  /** One diagnosis submission of the lead, with its answers and result */
  submissionAnswers: organizationProcedure
    .input(getSubmissionAnswersSchema)
    .query(async ({ ctx, input }) => {
      assertCanRead(ctx.ability);
      return getSubmissionAnswers(ctx.db, {
        organizationId: ctx.organization.id,
        leadId: input.leadId,
        submissionId: input.submissionId,
      });
    }),
});
