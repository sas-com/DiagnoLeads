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
 * Page the diagnosis on this page was started from (#332), set by the diagnosis while it is shown.
 * Its events (start, steps, complete, consultation...) carry it as `entry`, so the funnel of each
 * landing page can be told apart. Moves between pages (CTA and cross links) name their page
 * themselves instead.
 */
let diagnosisEntry: string | undefined;
const PAGE_EVENTS: ReadonlySet<string> = new Set(['ax_lp_cta_click', 'ax_cross_link_click']);

export function setAxDiagnosisEntry(entry: string | undefined): void {
  diagnosisEntry = entry;
}

export function trackAxEvent(event: string, params: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  const w = window as AnalyticsWindow;
  const payload =
    diagnosisEntry && !PAGE_EVENTS.has(event) ? { entry: diagnosisEntry, ...params } : params;
  if (typeof w.gtag === 'function') {
    w.gtag('event', event, payload);
    return;
  }
  if (Array.isArray(w.dataLayer)) {
    w.dataLayer.push({ event, ...payload });
  }
}
