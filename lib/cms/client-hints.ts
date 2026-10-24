import type { NextConfig } from 'next';

type HeaderRule = Awaited<ReturnType<NonNullable<NextConfig['headers']>>>[number];
type Header = HeaderRule['headers'][number];

/**
 * withPayload (@payloadcms/next) asks for this client hint on every path ('/:path*') so the admin
 * panel can follow the OS color scheme (getRequestTheme, read only by the admin's RootLayout).
 * Critical-CH makes Chrome send the first request of every visit twice ("307 Internal Redirect"),
 * which cost the public LPs 0.2-1.0 s (#497, #509).
 */
export const COLOR_SCHEME_HINT = 'Sec-CH-Prefers-Color-Scheme';

const HINT_HEADER_KEYS = new Set(['accept-ch', 'vary', 'critical-ch']);

/** Payload's admin panel: payload.config.ts sets no routes.admin, so it is the default /admin */
export const PAYLOAD_ADMIN_SOURCE = '/admin/:path*';

const isColorSchemeHint = (header: Header): boolean =>
  HINT_HEADER_KEYS.has(header.key.toLowerCase()) && header.value === COLOR_SCHEME_HINT;

/**
 * Moves the color-scheme client hint headers that withPayload adds for every path to the admin
 * panel only. Every other header, and every other rule, stays as it was. A rule left with no
 * headers is dropped (Next.js rejects an empty `headers` list).
 */
export function scopeClientHintsToAdmin(rules: HeaderRule[]): HeaderRule[] {
  const hints: Header[] = [];
  const scoped: HeaderRule[] = [];

  for (const rule of rules) {
    const kept = rule.headers.filter((header) => {
      if (!isColorSchemeHint(header)) return true;
      if (!hints.some((hint) => hint.key.toLowerCase() === header.key.toLowerCase())) {
        hints.push(header);
      }
      return false;
    });
    if (kept.length === rule.headers.length) scoped.push(rule);
    else if (kept.length > 0) scoped.push({ ...rule, headers: kept });
  }

  if (hints.length === 0) return rules;
  return [...scoped, { source: PAYLOAD_ADMIN_SOURCE, headers: hints }];
}

/** Wraps the headers() of a config (the output of withPayload) with scopeClientHintsToAdmin */
export function withAdminOnlyClientHints(config: NextConfig): NextConfig {
  const { headers } = config;
  if (!headers) return config;
  return {
    ...config,
    headers: async () => scopeClientHintsToAdmin(await headers()),
  };
}
