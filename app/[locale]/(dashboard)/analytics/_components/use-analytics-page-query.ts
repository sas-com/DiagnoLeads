'use client';

/**
 * The analytics page's tab and period, kept in the URL (#1216).
 *
 * The page shows a change at once from its own state and writes it to the address without a
 * history entry (a tab is a place on the page, not a step to go back through). When the address
 * changes from elsewhere (back, forward, a link to another tab), the state follows it.
 *
 * The component that calls it uses useSearchParams: in the App Router it must render inside
 * a <Suspense> boundary.
 */
import {
  type AnalyticsPageQuery,
  type AnalyticsTab,
  isAnalyticsTab,
  mergeAnalyticsPageQuery,
  parseAnalyticsPageQuery,
} from '@/lib/features/analytics/page-query';
import type { DateRange } from '@/lib/features/analytics/types/schemas';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface AnalyticsPageQueryController extends AnalyticsPageQuery {
  /** A tab's value as the tabs give it; anything else is ignored */
  setTab: (tab: string) => void;
  setRange: (range: DateRange) => void;
}

const keyOf = (query: AnalyticsPageQuery) => `${query.tab}|${query.range}`;

export function useAnalyticsPageQuery(): AnalyticsPageQueryController {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramsString = searchParams?.toString() ?? '';
  const inUrl = useMemo(
    () => parseAnalyticsPageQuery(new URLSearchParams(paramsString)),
    [paramsString]
  );

  const [query, setQuery] = useState(inUrl);
  // What this page last asked the address to say: a different address came from elsewhere
  const written = useRef(keyOf(inUrl));
  useEffect(() => {
    if (keyOf(inUrl) === written.current) return;
    written.current = keyOf(inUrl);
    setQuery(inUrl);
  }, [inUrl]);

  const latest = useRef({ query, paramsString, pathname });
  latest.current = { query, paramsString, pathname };

  const change = useCallback(
    (patch: Partial<AnalyticsPageQuery>) => {
      const { query: now, paramsString: current, pathname: path } = latest.current;
      const next = { ...now, ...patch };
      if (keyOf(next) === keyOf(now)) return;
      setQuery(next);
      written.current = keyOf(next);
      const search = mergeAnalyticsPageQuery(new URLSearchParams(current), next);
      router.replace(search ? `${path}?${search}` : path, { scroll: false });
    },
    [router]
  );

  const setTab = useCallback(
    (tab: string) => {
      if (isAnalyticsTab(tab)) change({ tab: tab satisfies AnalyticsTab });
    },
    [change]
  );
  const setRange = useCallback((range: DateRange) => change({ range }), [change]);

  return { ...query, setTab, setRange };
}
