import { isAxFrom } from '@/lib/features/ax-site/cross-links';
import { clipText } from '@/lib/utils/clip-text';

/**
 * UTM / referral / agency link parameters of the landing page, read once when the diagnosis starts.
 * `from` names the link of another AX page that led here (#332); only the site's own values are kept.
 */
export function readTrackingParams(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  // Cut without splitting a character: the server stores tracking as jsonb (#754)
  const clip = (value: string | null | undefined, max: number) =>
    value ? clipText(value, max) || undefined : undefined;
  const pick = (key: string) => clip(params.get(key), 200);
  const tracking: Record<string, string | undefined> = {
    utmSource: pick('utm_source'),
    utmMedium: pick('utm_medium'),
    utmCampaign: pick('utm_campaign'),
    utmContent: pick('utm_content'),
    utmTerm: pick('utm_term'),
    ref: clip(params.get('ref'), 100),
    agency: clip(params.get('agency'), 40),
    referrer: clip(document.referrer, 500),
    landingPath: clip(window.location.pathname, 500),
    from: isAxFrom(params.get('from')) ? (params.get('from') ?? undefined) : undefined,
  };
  return Object.fromEntries(
    Object.entries(tracking).filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
}
