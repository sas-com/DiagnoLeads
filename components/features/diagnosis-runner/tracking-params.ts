/** UTM / referral / agency link parameters of the landing page, read once when the diagnosis starts */
export function readTrackingParams(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const pick = (key: string) => params.get(key)?.slice(0, 200) || undefined;
  const tracking: Record<string, string | undefined> = {
    utmSource: pick('utm_source'),
    utmMedium: pick('utm_medium'),
    utmCampaign: pick('utm_campaign'),
    utmContent: pick('utm_content'),
    utmTerm: pick('utm_term'),
    ref: params.get('ref')?.slice(0, 100) || undefined,
    agency: params.get('agency')?.slice(0, 40) || undefined,
    referrer: document.referrer ? document.referrer.slice(0, 500) : undefined,
    landingPath: window.location.pathname.slice(0, 500),
  };
  return Object.fromEntries(
    Object.entries(tracking).filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
}
