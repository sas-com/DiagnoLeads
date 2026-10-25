const STATIC_FILE = /\.(js|css|woff|woff2|ttf|eot|ico|png|jpg|jpeg|gif|svg|webp|avif)$/;
// Pages of each language can end like a file ("/ja/leads/x/hearings/y.png" is a page id)
const LOCALE_PAGE = /^\/(ja|en)(\/|$)/i;

/**
 * Cache control headers by path type
 */
export function getCacheHeaders(pathname: string): Record<string, string> {
  // API routes - no cache
  if (pathname.startsWith('/api/')) {
    return {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    };
  }

  // The QR entry of campaigns (#503): a redirect that must follow a paused campaign at once
  if (pathname.startsWith('/q/')) {
    return { 'Cache-Control': 'no-store' };
  }

  // Files - left to Next.js. The proxy does not run on the build files nor on the folders of
  // public/ (proxy.ts); what reaches it is an icon of the app (Next.js caches it itself) or a
  // missing file, whose 404 must not be kept for a year (#68)
  if (STATIC_FILE.test(pathname) && !LOCALE_PAGE.test(pathname)) {
    return {};
  }

  // HTML pages - short cache with revalidation
  return {
    'Cache-Control': 'public, max-age=0, must-revalidate',
  };
}

/** The sign-in redirect depends on the visitor's cookie: never kept by browsers or CDNs */
export const SIGN_IN_REDIRECT_CACHE_HEADERS = { 'Cache-Control': 'private, no-store' };
