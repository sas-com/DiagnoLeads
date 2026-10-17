'use client';

import { GA_SCRIPT_HOST } from '@/lib/analytics/ga';
import { useEffect } from 'react';

type GtagWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

/**
 * Loads GA4 (gtag.js) once on the AX migration site. Added from this script rather than a <script>
 * tag: the page's scripts carry the CSP nonce, and 'strict-dynamic' trusts what they add.
 */
export function AxAnalytics({ measurementId }: { measurementId: string }) {
  useEffect(() => {
    const w = window as GtagWindow;
    if (w.gtag) return;
    w.dataLayer = w.dataLayer ?? [];
    // gtag reads its commands as `arguments` objects, as in Google's snippet
    w.gtag = function gtag() {
      // biome-ignore lint/style/noArguments: gtag.js expects the arguments object itself
      w.dataLayer?.push(arguments);
    };
    w.gtag('js', new Date());
    w.gtag('config', measurementId);

    const script = document.createElement('script');
    script.async = true;
    script.src = `${GA_SCRIPT_HOST}/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);
  }, [measurementId]);

  return null;
}
