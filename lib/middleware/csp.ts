/**
 * Content Security Policy of the app (set by the root middleware on every page).
 *
 * Production keeps scripts and <style> elements to the per-request nonce:
 * - style-src-attr: style attributes rendered on the server (progress bars, layout parts)
 *   cannot run scripts, so they are allowed. Never put user text into a style attribute
 *   (colors are checked against a pattern, numbers are clamped).
 * - frame-src: the Cloudflare Turnstile check on the public diagnosis (its script is added by
 *   the page's own script, which 'strict-dynamic' allows; development lists the script host,
 *   having no nonce)
 */
export function contentSecurityPolicy(nonce: string, isDevelopment: boolean): string {
  const policy = isDevelopment
    ? // Development: より緩い CSP（Hot Reload 対応）
      `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline' https://challenges.cloudflare.com;
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data:;
    font-src 'self' data:;
    connect-src 'self' ws: wss:;
    frame-src https://challenges.cloudflare.com;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
  `
    : // Production: 厳格な CSP
      `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
    style-src 'self' 'nonce-${nonce}';
    style-src-attr 'unsafe-inline';
    img-src 'self' blob: data: https:;
    font-src 'self' data:;
    frame-src https://challenges.cloudflare.com;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `;
  return policy.replace(/\s{2,}/g, ' ').trim();
}
