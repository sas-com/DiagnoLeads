/**
 * Forecast tRPC router (Refs #437)
 *
 * Anyone who can read leads may read the forecast (the figures come from the deals and the
 * targets, which they can read too). Every query is scoped by organizationId.
 */

import { jstDate } from '@/lib/features/leads/types/pipeline';
import { getFiscalYearStartMonth } from '@/lib/features/sales-targets/service';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { forecastPeriodEnum, forecastRange } from '../period';
import { getForecast, getPipelineChanges } from '../service';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const forecastInputSchema = z.object({
  organizationId: z.string().uuid(),
  period: forecastPeriodEnum.default('thisQuarter'),
});

export const salesForecastRouter = router({
  /** Targets, won and expected amounts of the period per owner, and the week's changes */
  get: organizationProcedure.input(forecastInputSchema).query(async ({ ctx, input }) => {
    if (!ctx.ability.can('read', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to read the forecast',
      });
    }
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
      changes,
      canEditTargets: ctx.ability.can('update', 'Settings'),
    };
  }),
});
