import { isAxFrom } from '@/lib/features/ax-site/cross-links';

/**
 * What a page view records besides the page (#412): only the referrer's host, the utm_*
 * parameters, the AX `from` and the kind of device. The full referrer, the user agent and the
 * IP address are never stored.
 */

/**
 * The part of a User-Agent that isBot and deviceOf read (#705). A browser's is a few hundred
 * characters; the tablet pattern of deviceOf takes time in the square of the length, so a long
 * header sent on purpose is cut here, before any pattern runs, for every caller (/api/collect
 * and the QR entry). isBot reads the same head, so whether a request is a bot and which device
 * it is are told from the same characters
 */
const USER_AGENT_CHARS = 512;

const headOf = (userAgent: string) => userAgent.slice(0, USER_AGENT_CHARS);

/** Crawlers, previews and headless browsers are not visitors */
const BOT =
  /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|embedly|whatsapp|curl|wget|python-requests|httpclient|monitor/i;

/** Judged from the first USER_AGENT_CHARS characters only */
export function isBot(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT.test(headOf(userAgent));
}

export type SiteDevice = 'desktop' | 'mobile' | 'tablet';

/** Judged from the first USER_AGENT_CHARS characters only */
export function deviceOf(userAgent: string): SiteDevice {
  const head = headOf(userAgent);
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(head)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(head)) return 'mobile';
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

/**
 * A value that looks like an email address is dropped: a mailing tool may put one in utm_*. So is
 * one with NUL ("%00" in the query string), which PostgreSQL cannot store (#648).
 */
const clip = (value: string | null) => {
  const trimmed = value?.trim();
  return trimmed && !trimmed.includes('@') && !trimmed.includes('\u0000')
    ? trimmed.slice(0, 200)
    : null;
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
