import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { intlMiddleware, shouldSkipI18nMiddleware, stripLocalePrefix } from './lib/i18n/middleware';
import { signInRedirect } from './lib/middleware/auth-redirect';
import { contentSecurityPolicy } from './lib/middleware/csp';
import {
  checkRateLimit,
  getRateLimitConfig,
  setRateLimitHeaders,
} from './lib/middleware/rate-limit';

/**
 * Cache control headers for static assets
 */
function getCacheHeaders(pathname: string): Record<string, string> {
  // Static assets - cache for 1 year
  if (pathname.match(/\.(js|css|woff|woff2|ttf|eot|ico|png|jpg|jpeg|gif|svg|webp|avif)$/)) {
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

/**
 * Security headers including CSP
 */
function getSecurityHeaders(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const isDevelopment = process.env.NODE_ENV === 'development';

  return {
    // Content Security Policy
    'Content-Security-Policy': contentSecurityPolicy(nonce, isDevelopment),

    // セキュリティヘッダー
    'X-DNS-Prefetch-Control': 'on',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',

    // CSP nonce for inline scripts
    'X-Nonce': nonce,
  };
}

/**
 * Next.js Middleware
 * Runs before every request to check i18n, rate limit, authentication, and add security headers
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
  const cacheHeaders = getCacheHeaders(pathname);
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
     * - public files
     * - admin (PayloadCMS admin panel)
     */
    '/((?!_next/static|_next/image|favicon.ico|admin|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    // Pages of each language, even when the last segment looks like an image ("y.png" can be
    // a page id): they need the sign-in redirect and the security headers
    '/(ja|en)/:path*',
  ],
};
