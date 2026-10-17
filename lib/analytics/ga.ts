/**
 * Google Analytics 4 for the AX migration site (#205).
 * Off unless NEXT_PUBLIC_GA_MEASUREMENT_ID is set; the ID goes into a script URL and decides the
 * CSP, so anything but a GA4 measurement ID ("G-" and letters / digits) is ignored.
 */
const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;

export function gaMeasurementId(): string | undefined {
  const id = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim();
  return id && MEASUREMENT_ID.test(id) ? id : undefined;
}

/**
 * Hosts gtag.js loads from and sends hits to (Google's GA4 CSP guidance). doubleclick.net and
 * google.com receive hits once Google signals is turned on in the GA4 property.
 */
export const GA_SCRIPT_HOST = 'https://www.googletagmanager.com';
export const GA_CONNECT_SOURCES = [
  'https://*.google-analytics.com',
  'https://*.analytics.google.com',
  'https://*.googletagmanager.com',
  'https://*.g.doubleclick.net',
  'https://*.google.com',
] as const;
export const GA_IMG_SOURCES = [
  'https://*.google-analytics.com',
  'https://*.googletagmanager.com',
] as const;
