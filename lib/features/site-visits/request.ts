import { isAxFrom } from '@/lib/features/ax-site/cross-links';

/**
 * What a page view records besides the page (#412): only the referrer's host, the utm_*
 * parameters, the AX `from` and the kind of device. The full referrer, the user agent and the
 * IP address are never stored.
 */

/** Crawlers, previews and headless browsers are not visitors */
const BOT =
  /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|embedly|whatsapp|curl|wget|python-requests|httpclient|monitor/i;

export function isBot(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT.test(userAgent);
}

export type SiteDevice = 'desktop' | 'mobile' | 'tablet';

export function deviceOf(userAgent: string): SiteDevice {
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(userAgent)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

/** The host of the referrer, lowercase, or null when there is none or it is not a web address */
export function referrerHostOf(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.hostname.toLowerCase().slice(0, 253) || null;
  } catch {
    return null;
  }
}

export interface SiteVisitParams {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  fromRef: string | null;
}

const clip = (value: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
};

/** The utm_* and `from` of the page's query string ("?utm_source=x&from=ax-lp-header") */
export function visitParamsOf(search: string | null | undefined): SiteVisitParams {
  const params = new URLSearchParams((search ?? '').slice(0, 2000));
  const from = params.get('from');
  return {
    utmSource: clip(params.get('utm_source')),
    utmMedium: clip(params.get('utm_medium')),
    utmCampaign: clip(params.get('utm_campaign')),
    utmContent: clip(params.get('utm_content')),
    utmTerm: clip(params.get('utm_term')),
    fromRef: isAxFrom(from) ? from : null,
  };
}
