/** "@a.co.jp、@b.co.jp" in Japanese, "@a.co.jp and @b.co.jp" in English */
export function formatEmailDomains(domains: readonly string[], locale: string): string {
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format(
    domains.map((domain) => `@${domain}`)
  );
}
