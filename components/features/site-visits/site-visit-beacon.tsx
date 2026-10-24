'use client';

import { sitePageOf } from '@/lib/features/site-visits/pages';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Whether the page the document was loaded with has been seen. document.referrer stays the one of
 * that load through every move within the site, so it is sent for that page only: a later page
 * came from this site, as after a full load. Kept per document, not per component, so a layout
 * that mounts again (another locale) does not send the outside referrer twice
 */
let loadSeen = false;

/**
 * Sends one view of a public page to /api/collect (#412), on load and on every move within the
 * site; the outside referrer goes with the page of the load only. Rendered by the root layout
 * only while the measurement is on (SITE_VISITS_ENABLED); pages that are not measured (the admin
 * screens, sign-in) send nothing.
 * No cookie and no storage: only the path, the query (the server keeps utm_* and `from`) and
 * the referrer (the server keeps its host) are sent.
 */
export function SiteVisitBeacon() {
  const pathname = usePathname();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    const atLoad = !loadSeen;
    loadSeen = true;
    // pathname changes on every move; the effect also runs twice in development
    if (!sitePageOf(pathname)) return;
    const key = `${pathname}${window.location.search}`;
    if (lastSent.current === key) return;
    lastSent.current = key;

    const body = JSON.stringify({
      path: pathname,
      search: window.location.search,
      referrer: atLoad ? document.referrer : window.location.origin,
    });
    const blob = new Blob([body], { type: 'text/plain' });
    if (navigator.sendBeacon?.('/api/collect', blob)) return;
    // Browsers without sendBeacon, or when it refused (the queue was full)
    void fetch('/api/collect', { method: 'POST', body, keepalive: true }).catch(() => {});
  }, [pathname]);

  return null;
}
