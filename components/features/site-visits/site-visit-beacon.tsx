'use client';

import { sitePageOf } from '@/lib/features/site-visits/pages';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Sends one view of a public page to /api/collect (#412), on load and on every move within the
 * site. Rendered by the root layout only while the measurement is on (SITE_VISITS_ENABLED);
 * pages that are not measured (the admin screens, sign-in) send nothing.
 * No cookie and no storage: only the path, the query (the server keeps utm_* and `from`) and
 * the referrer (the server keeps its host) are sent.
 */
export function SiteVisitBeacon() {
  const pathname = usePathname();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    // pathname changes on every move; the effect also runs twice in development
    if (!sitePageOf(pathname)) return;
    const key = `${pathname}${window.location.search}`;
    if (lastSent.current === key) return;
    lastSent.current = key;

    const body = JSON.stringify({
      path: pathname,
      search: window.location.search,
      referrer: document.referrer,
    });
    const blob = new Blob([body], { type: 'text/plain' });
    if (navigator.sendBeacon?.('/api/collect', blob)) return;
    // Browsers without sendBeacon, or when it refused (the queue was full)
    void fetch('/api/collect', { method: 'POST', body, keepalive: true }).catch(() => {});
  }, [pathname]);

  return null;
}
