import { z } from 'zod';

/** Periods of the site analytics screen (#755), as STUDIO offers them */
export const SITE_ANALYTICS_PERIODS = [7, 30, 90] as const;
export type SiteAnalyticsPeriod = (typeof SITE_ANALYTICS_PERIODS)[number];

export const siteOverviewSchema = z.object({
  organizationId: z.string().uuid(),
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
});
