import { isAxFrom } from '@/lib/features/ax-site/cross-links';

/**
 * Send AX diagnosis events to GA4 (gtag, loaded by AxAnalytics when a measurement ID is set) or
 * to a GTM data layer when one is present. Used to measure the funnel (start → complete →
 * consultation) and hypothesis H1. Without either, nothing is sent.
 */
type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

/**
 * Page the diagnosis on this page was started from (#332), set by the diagnosis while it is shown,
 * and the link of another AX page that led here (`from` of the address, the values the tracking
 * keeps only). The diagnosis events (start, steps, complete, consultation...) carry them as
 * `entry` and `from`, so the funnel of each landing page and of each cross link can be told
 * apart. Moves between pages (CTA and cross links) name their page themselves instead.
 */
let diagnosisContext: { entry?: string; from?: string } = {};
const PAGE_EVENTS: ReadonlySet<string> = new Set(['ax_lp_cta_click', 'ax_cross_link_click']);

export function setAxDiagnosisEntry(entry: string | undefined): void {
  if (!entry || typeof window === 'undefined') {
    diagnosisContext = {};
    return;
  }
  const from = new URLSearchParams(window.location.search).get('from');
  diagnosisContext = { entry, ...(isAxFrom(from) ? { from } : {}) };
}

export function trackAxEvent(event: string, params: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  const w = window as AnalyticsWindow;
  const payload = PAGE_EVENTS.has(event) ? params : { ...diagnosisContext, ...params };
  if (typeof w.gtag === 'function') {
    w.gtag('event', event, payload);
    return;
  }
  if (Array.isArray(w.dataLayer)) {
    w.dataLayer.push({ event, ...payload });
  }
}
