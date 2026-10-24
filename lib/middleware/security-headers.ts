/**
 * Headers the root proxy (proxy.ts) adds to every response it handles, besides the CSP.
 * vercel.json sends the ones a static file needs as well (the proxy does not run on those): the
 * values must stay the same in both (test/unit/lib/middleware/security-headers.test.ts).
 */
export const SECURITY_HEADERS = {
  'X-DNS-Prefetch-Control': 'on',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  // The browsers' XSS filter stays off (OWASP): current browsers have dropped it, and where it
  // remains it can be made to remove parts of a page. The CSP is what blocks injected scripts.
  'X-XSS-Protection': '0',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
} as const;
