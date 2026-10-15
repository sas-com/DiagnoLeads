import { env } from '@/lib/env';

/**
 * The legacy generic diagnosis form (/[locale]/diagnostic, POST /api/diagnostic) is off in
 * production unless LEGACY_DIAGNOSTIC_FORM_ENABLED=true: it has none of the AX diagnosis
 * guards (Turnstile, DB rate limits, a fixed receiving organization) and emails any address
 * given in the form (#71). Development and preview deployments keep it.
 */
export function isLegacyDiagnosticFormEnabled(): boolean {
  if (process.env.VERCEL_ENV !== 'production') return true;
  return env.LEGACY_DIAGNOSTIC_FORM_ENABLED === 'true';
}
