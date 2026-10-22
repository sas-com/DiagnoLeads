/**
 * The two unsubscribe URLs of a respondent mail (#154):
 * - the page, linked from the footer: `${base}/${locale}/email/unsubscribe#t=${token}`. The token
 *   is in the fragment, which browsers never send, so it reaches neither the server logs nor a
 *   Referer. Opening the page changes nothing; its button does (mail scanners open links)
 * - the one-click endpoint of the List-Unsubscribe header (RFC 8058):
 *   `${base}/api/email/unsubscribe/one-click?t=${token}`. Mail providers POST to the URL as it
 *   is, so the token has to be in the query there
 *
 * Both must survive safeUrl (https, or http on localhost outside production); building fails
 * otherwise, so no mail goes out without a working unsubscribe.
 */
import { safeUrl } from '@/lib/email/templates/render';

export type UnsubscribeLocale = 'ja' | 'en';

/** Path of the unsubscribe page after the locale */
export const UNSUBSCRIBE_PAGE_PATH = '/email/unsubscribe';
/** Path of the RFC 8058 one-click endpoint */
export const ONE_CLICK_UNSUBSCRIBE_PATH = '/api/email/unsubscribe/one-click';

export interface UnsubscribeUrls {
  /** Footer link: the page with the button, token in the fragment */
  unsubscribePageUrlFor: (token: string) => string;
  /** List-Unsubscribe header: the one-click POST endpoint, token in the query */
  oneClickUrlFor: (token: string) => string;
}

function requireSafe(url: string, what: string): string {
  const safe = safeUrl(url);
  if (!safe) throw new Error(`Respondent email: the ${what} URL is not https`);
  return safe;
}

/**
 * Builders of both URLs from the app's base URL (NEXT_PUBLIC_APP_URL unless given) and the
 * language of the page.
 */
export function unsubscribeUrls(options: {
  locale: UnsubscribeLocale;
  baseUrl?: string;
}): UnsubscribeUrls {
  const base = (options.baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
  const locale = options.locale === 'en' ? 'en' : 'ja';
  return {
    unsubscribePageUrlFor: (token) =>
      requireSafe(
        `${base}/${locale}${UNSUBSCRIBE_PAGE_PATH}#t=${encodeURIComponent(token)}`,
        'unsubscribe page'
      ),
    oneClickUrlFor: (token) =>
      requireSafe(
        `${base}${ONE_CLICK_UNSUBSCRIBE_PATH}?t=${encodeURIComponent(token)}`,
        'one-click unsubscribe'
      ),
  };
}
