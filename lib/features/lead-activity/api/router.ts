/**
 * Lead activity tRPC router (Refs #101)
 *
 * Anyone who can read leads may read the timeline (including viewers from a parent
 * organization). Every query is scoped by organizationId and leadId (see ../service.ts).
 */

import type { AppAbility } from '@/lib/auth/permissions';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { getSubmissionAnswers, listLeadActivities } from '../service';
import { getSubmissionAnswersSchema, listLeadActivitiesSchema } from '../types/schemas';

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
