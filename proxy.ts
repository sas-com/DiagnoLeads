import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { gaMeasurementId } from './lib/analytics/ga';
import { isCmsApiPath, isCmsEnabled } from './lib/cms/enabled';
import { intlMiddleware, shouldSkipI18nMiddleware, stripLocalePrefix } from './lib/i18n/middleware';
import { signInRedirect } from './lib/middleware/auth-redirect';
import { SIGN_IN_REDIRECT_CACHE_HEADERS, getCacheHeaders } from './lib/middleware/cache-headers';
import { contentSecurityPolicy, isLocalHost } from './lib/middleware/csp';
import {
  checkRateLimit,
  getRateLimitConfig,
  setRateLimitHeaders,
} from './lib/middleware/rate-limit';
import { SECURITY_HEADERS } from './lib/middleware/security-headers';

/**
 * Security headers including CSP
 */
function getSecurityHeaders(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const isDevelopment = process.env.NODE_ENV === 'development';

  return {
    // Content Security Policy
    'Content-Security-Policy': contentSecurityPolicy(nonce, isDevelopment, {
      analytics: gaMeasurementId() !== undefined,
      // Off only for plain http to the machine itself (E2E with `next start`); Vercel is https
      upgradeInsecureRequests: !(
        request.nextUrl.protocol === 'http:' && isLocalHost(request.nextUrl.hostname)
      ),
    }),

    // セキュリティヘッダー
    ...SECURITY_HEADERS,

    // CSP nonce for inline scripts
    'X-Nonce': nonce,
  };
}

/**
 * Next.js Middleware
 * Runs before every request to check i18n, rate limit, authentication, and add security headers
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 0. The CMS API answers nothing while the CMS is off (lib/cms/enabled.ts, #141)
  if (!isCmsEnabled() && isCmsApiPath(pathname)) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  // 1. Handle i18n (locale routing)
  // Skip i18n for API routes, static files, etc.
  let intlResponse: NextResponse | undefined;
  if (!shouldSkipI18nMiddleware(pathname)) {
    intlResponse = intlMiddleware(request);
    // If i18n middleware returns a redirect, return it immediately
    if (intlResponse && intlResponse.status === 307) {
      return intlResponse;
    }
  }

  // Strip locale prefix for route checking
  // Example: /ja/dashboard -> /dashboard
  const pathnameWithoutLocale = stripLocalePrefix(pathname);

  // 2. Check rate limit
  const rateLimitConfig = getRateLimitConfig(pathnameWithoutLocale);
  const rateLimitResult = checkRateLimit(request, rateLimitConfig);

  if (!rateLimitResult.allowed) {
    // Rate limit exceeded
    const response = NextResponse.json(
      {
        error: 'Too Many Requests',
        message: 'レート制限を超過しました。しばらくしてから再度お試しください。',
      },
      { status: 429 }
    );

    setRateLimitHeaders(response.headers, rateLimitResult);
    return response;
  }

  // 3. Get security headers
  const securityHeaders = getSecurityHeaders(request);

  // 4. Signed-out visitors of admin pages go to sign-in. Each API checks the session itself;
  // this only avoids showing an empty admin shell (lib/middleware/auth-redirect.ts).
  const signIn = signInRedirect(request);
  // Build on the next-intl response: it carries the locale header that server components
  // read through getTranslations() / getRequestConfig(). Replacing it with a plain
  // NextResponse.next() made every server-rendered string fall back to Japanese on /en.
  const response = signIn ? NextResponse.redirect(signIn) : (intlResponse ?? NextResponse.next());

  // 5. Add rate limit headers to response
  setRateLimitHeaders(response.headers, rateLimitResult);

  // 6. Add security headers to response
  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value);
  }

  // 7. Add cache control headers
  const cacheHeaders = signIn ? SIGN_IN_REDIRECT_CACHE_HEADERS : getCacheHeaders(pathname);
  for (const [key, value] of Object.entries(cacheHeaders)) {
    response.headers.set(key, value);
  }

  return response;
}

/**
 * Configure which routes use this middleware
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images/, fonts/ (the folders of public/), by name: any other path gets the headers,
     *   also when it ends like a file (app/icon.svg is served by the app, #68)
     * - admin (PayloadCMS admin panel), that segment only: off in production (vercel.json sends
     *   it to the dashboard), and the strict policy would block the <style> elements its UI
     *   adds (react-select, sonner). Its headers are decided before the CMS is turned on in
     *   production (#525, Epic #339 P12)
     * - _vercel (Vercel Web Analytics script and endpoint, #222)
     */
    '/((?!_next/static|_next/image|_vercel|favicon.ico|images/|fonts/|admin(?:/|$)).*)',
    // Pages of each language, even when the last segment looks like an image ("y.png" can be
    // a page id): they need the sign-in redirect and the security headers
    '/(ja|en)/:path*',
    // Every API path, even when it ends like an image: the CMS API is off in production (#141)
    '/api/:path*',
  ],
};
