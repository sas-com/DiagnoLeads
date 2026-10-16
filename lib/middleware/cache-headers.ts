const STATIC_FILE = /\.(js|css|woff|woff2|ttf|eot|ico|png|jpg|jpeg|gif|svg|webp|avif)$/;
// Pages of each language can end like a file ("/ja/leads/x/hearings/y.png" is a page id)
const LOCALE_PAGE = /^\/(ja|en)(\/|$)/i;

/**
 * Cache control headers by path type
 */
export function getCacheHeaders(pathname: string): Record<string, string> {
  // Static assets - cache for 1 year
  if (STATIC_FILE.test(pathname) && !LOCALE_PAGE.test(pathname)) {
    return {
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
  }

  // API routes - no cache
  if (pathname.startsWith('/api/')) {
    return {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    };
  }

  // HTML pages - short cache with revalidation
  return {
    'Cache-Control': 'public, max-age=0, must-revalidate',
  };
}

/** The sign-in redirect depends on the visitor's cookie: never kept by browsers or CDNs */
export const SIGN_IN_REDIRECT_CACHE_HEADERS = { 'Cache-Control': 'private, no-store' };
