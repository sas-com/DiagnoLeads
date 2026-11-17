/**
 * The analytics page's tab and period in the URL (#1216), so a link from elsewhere (the
 * marketing room's boards), back and reload show the same figures.
 *
 * - parseAnalyticsPageQuery: URL search params -> tab and period. Never throws: an unknown or
 *   broken value falls back to the page's own start (overview, the last 30 days).
 * - mergeAnalyticsPageQuery: writes the two back, keeping the other params. The start values are
 *   left out, so the plain address stays plain.
 * - analyticsPageHref: a link for other pages (without the locale).
 *
 * Pure functions only, usable on the server and in tests.
 */
import { type DateRange, dateRangeSchema } from './types/schemas';

export const ANALYTICS_TABS = ['overview', 'sources', 'funnel', 'performance'] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];

export interface AnalyticsPageQuery {
  tab: AnalyticsTab;
  range: DateRange;
}

export const ANALYTICS_PAGE_START: AnalyticsPageQuery = { tab: 'overview', range: '30d' };

const TAB_PARAM = 'tab';
const RANGE_PARAM = 'range';

export function isAnalyticsTab(value: unknown): value is AnalyticsTab {
  return (ANALYTICS_TABS as readonly unknown[]).includes(value);
}

export function parseAnalyticsPageQuery(params: URLSearchParams): AnalyticsPageQuery {
  const tab = params.get(TAB_PARAM);
  const range = dateRangeSchema.safeParse(params.get(RANGE_PARAM));
  return {
    tab: isAnalyticsTab(tab) ? tab : ANALYTICS_PAGE_START.tab,
    range: range.success ? range.data : ANALYTICS_PAGE_START.range,
  };
}

/** The search string (without '?') for the query, keeping the params the page does not own */
export function mergeAnalyticsPageQuery(
  current: URLSearchParams,
  next: AnalyticsPageQuery
): string {
  const params = new URLSearchParams(current);
  if (next.tab === ANALYTICS_PAGE_START.tab) params.delete(TAB_PARAM);
  else params.set(TAB_PARAM, next.tab);
  if (next.range === ANALYTICS_PAGE_START.range) params.delete(RANGE_PARAM);
  else params.set(RANGE_PARAM, next.range);
  return params.toString();
}

/**
 * The analytics page at a tab and a period, for a link from another page. Both are always
 * written, so the link keeps its meaning if the page's start ever changes.
 */
export function analyticsPageHref(query: AnalyticsPageQuery): string {
  const params = new URLSearchParams({ [TAB_PARAM]: query.tab, [RANGE_PARAM]: query.range });
  return `/analytics?${params.toString()}`;
}
