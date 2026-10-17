/**
 * Send AX diagnosis events to GA4 (gtag, loaded by AxAnalytics when a measurement ID is set) or
 * to a GTM data layer when one is present. Used to measure the funnel (start → complete →
 * consultation) and hypothesis H1. Without either, nothing is sent.
 */
type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

export function trackAxEvent(event: string, params: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  const w = window as AnalyticsWindow;
  if (typeof w.gtag === 'function') {
    w.gtag('event', event, params);
    return;
  }
  if (Array.isArray(w.dataLayer)) {
    w.dataLayer.push({ event, ...params });
  }
}
