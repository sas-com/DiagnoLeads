/**
 * The site's own visit measurement (#412) is off unless SITE_VISITS_ENABLED=true. It is turned on
 * in production only once the privacy policy describes it (#51, decided 2026-10-23); while off,
 * the pages send nothing and /api/collect writes nothing.
 */
export function siteVisitsEnabled(value = process.env.SITE_VISITS_ENABLED): boolean {
  return value === 'true';
}
