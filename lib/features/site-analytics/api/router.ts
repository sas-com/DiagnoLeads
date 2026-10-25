/**
 * Site analytics tRPC router (#755, Epic #411). Readable by those who can read leads, except
 * viewers from a parent organization, as the other analytics reports. Totals only, scoped by
 * organization (see ../service.ts).
 */

import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { siteOverviewSchema } from '../schemas';
import { getSiteOverview } from '../service';

const READ_EXCLUDED_ROLES: readonly string[] = ['parent_viewer'];

export const siteAnalyticsRouter = router({
  /** Daily visitors and page views of the period, the previous period and the pages */
  overview: organizationProcedure.input(siteOverviewSchema).query(({ ctx, input }) => {
    if (!ctx.ability.can('read', 'Lead') || READ_EXCLUDED_ROLES.includes(ctx.membership.role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to read the site analytics',
      });
    }
    return getSiteOverview(ctx.db, { organizationId: ctx.organization.id, days: input.days });
  }),
});
