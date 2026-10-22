/**
 * Google Search Console ownership check by HTML tag (#51). Off unless
 * NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION is set; the value goes into a meta tag on every locale
 * page, so anything but a verification token (letters, digits, "-" and "_") is ignored.
 */
const TOKEN = /^[A-Za-z0-9_-]{10,100}$/;

export function googleSiteVerification(): string | undefined {
  const token = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();
  return token && TOKEN.test(token) ? token : undefined;
}
