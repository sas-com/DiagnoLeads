/**
 * Forecast tRPC router (Refs #437)
 *
 * Those who may read deals may read the forecast (lib/features/deals/access.ts: not a parent
 * organization's viewer). Each rep's target and achievement are shown to those who set the
 * targets and to the rep only (ownerRowsFor). Every query is scoped by organizationId.
 */

import { canReadDeals } from '@/lib/features/deals/service';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { getFiscalYearStartMonth } from '@/lib/features/sales-targets/service';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { forecastPeriodEnum, forecastRange } from '../period';
import { ownerRowsFor } from '../report';
import { getForecast, getPipelineChanges } from '../service';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const forecastInputSchema = z.object({
  organizationId: z.string().uuid(),
  period: forecastPeriodEnum.default('thisQuarter'),
});

export const salesForecastRouter = router({
  /** Targets, won and expected amounts of the period per owner, and the week's changes */
  get: organizationProcedure.input(forecastInputSchema).query(async ({ ctx, input }) => {
    if (!canReadDeals(ctx)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to read the forecast',
      });
    }
    const canEditTargets = ctx.ability.can('update', 'Settings');
    const organizationId = ctx.organization.id;
    const today = jstDate();
    const startMonth = await getFiscalYearStartMonth(ctx.db, organizationId);
    const range = forecastRange(input.period, today, startMonth);
    const [forecast, changes] = await Promise.all([
      getForecast(ctx.db, { organizationId, range }),
      getPipelineChanges(ctx.db, { organizationId, since: new Date(Date.now() - WEEK_MS) }),
    ]);
    return {
      period: input.period,
      range,
      today,
      fiscalYearStartMonth: startMonth,
      ...forecast,
      owners: ownerRowsFor(forecast.owners, {
        userId: ctx.user.id,
        seesEveryTarget: canEditTargets,
      }),
      changes,
      canEditTargets,
      /** To mark the viewer's own row (#721) */
      viewerUserId: ctx.user.id,
    };
  }),
});
