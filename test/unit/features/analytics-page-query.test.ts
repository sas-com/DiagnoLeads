/**
 * The analytics page's tab and period in the URL (#1216): reading never throws, the start values
 * stay out of the address, and a link from another page names both.
 */
import {
  ANALYTICS_PAGE_START,
  ANALYTICS_TABS,
  analyticsPageHref,
  isAnalyticsTab,
  mergeAnalyticsPageQuery,
  parseAnalyticsPageQuery,
} from '@/lib/features/analytics/page-query';
import { dateRangeSchema } from '@/lib/features/analytics/types/schemas';
import { describe, expect, it } from 'vitest';

const parse = (search: string) => parseAnalyticsPageQuery(new URLSearchParams(search));
const merge = (search: string, next: Parameters<typeof mergeAnalyticsPageQuery>[1]) =>
  mergeAnalyticsPageQuery(new URLSearchParams(search), next);

describe('parseAnalyticsPageQuery', () => {
  it('starts at the overview of the last 30 days when the address says nothing', () => {
    expect(parse('')).toEqual({ tab: 'overview', range: '30d' });
    expect(ANALYTICS_PAGE_START).toEqual({ tab: 'overview', range: '30d' });
  });

  it('reads every tab and every period the page offers', () => {
    for (const tab of ANALYTICS_TABS) expect(parse(`tab=${tab}`).tab).toBe(tab);
    for (const range of dateRangeSchema.options) expect(parse(`range=${range}`).range).toBe(range);
    expect(parse('tab=funnel&range=90d')).toEqual({ tab: 'funnel', range: '90d' });
  });

  it('drops a value it does not know, and keeps the other one', () => {
    expect(parse('tab=nowhere&range=90d')).toEqual({ tab: 'overview', range: '90d' });
    expect(parse('tab=sources&range=1y')).toEqual({ tab: 'sources', range: '30d' });
    expect(parse('tab=&range=')).toEqual({ tab: 'overview', range: '30d' });
    // Names are exact: nothing is guessed from a near miss
    expect(parse('tab=Sources&range=30D')).toEqual({ tab: 'overview', range: '30d' });
    // The first value counts when one is given twice
    expect(parse('tab=funnel&tab=sources').tab).toBe('funnel');
  });
});

describe('mergeAnalyticsPageQuery', () => {
  it('leaves the start values out of the address', () => {
    expect(merge('', { tab: 'overview', range: '30d' })).toBe('');
    expect(merge('tab=funnel&range=90d', { tab: 'overview', range: '30d' })).toBe('');
  });

  it('writes what differs from the start', () => {
    expect(merge('', { tab: 'sources', range: '30d' })).toBe('tab=sources');
    expect(merge('', { tab: 'overview', range: 'all' })).toBe('range=all');
    expect(merge('tab=sources', { tab: 'funnel', range: '7d' })).toBe('tab=funnel&range=7d');
  });

  it('keeps the params the page does not own, and does not change what it was given', () => {
    const current = new URLSearchParams('from=office&tab=sources');
    expect(mergeAnalyticsPageQuery(current, { tab: 'overview', range: '90d' })).toBe(
      'from=office&range=90d'
    );
    expect(current.toString()).toBe('from=office&tab=sources');
  });

  it('gives back what the page reads', () => {
    for (const tab of ANALYTICS_TABS) {
      for (const range of dateRangeSchema.options) {
        expect(parse(merge('', { tab, range }))).toEqual({ tab, range });
      }
    }
  });
});

describe('analyticsPageHref', () => {
  it('names the tab and the period, the start values too', () => {
    expect(analyticsPageHref({ tab: 'sources', range: '30d' })).toBe(
      '/analytics?tab=sources&range=30d'
    );
    expect(analyticsPageHref({ tab: 'overview', range: '30d' })).toBe(
      '/analytics?tab=overview&range=30d'
    );
  });
});

describe('isAnalyticsTab', () => {
  it('knows the four tabs only', () => {
    expect(ANALYTICS_TABS).toEqual(['overview', 'sources', 'funnel', 'performance']);
    expect(isAnalyticsTab('funnel')).toBe(true);
    expect(isAnalyticsTab('site')).toBe(false);
    expect(isAnalyticsTab(null)).toBe(false);
  });
});
