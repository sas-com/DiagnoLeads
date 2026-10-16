import { ExternalLink } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AxLogo } from './ax-logo';
import { AX_SITE_LINKS, axPrivacyPolicyUrl } from './site-config';

/** Footer in the maru2-dx.com layout: logo and links, a rule, then the copyright */
export async function AxSiteFooter({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'axSite.footer' });
  const tb = await getTranslations({ locale, namespace: 'axSite.brand' });
  const privacyPolicyUrl = axPrivacyPolicyUrl();
  const links = [
    { href: AX_SITE_LINKS.operator, label: t('company') },
    { href: AX_SITE_LINKS.relatedService, label: t('related') },
    ...(privacyPolicyUrl ? [{ href: privacyPolicyUrl, label: t('privacy') }] : []),
  ];

  return (
    // ax-teal-dark rather than the lighter teal of maru2-dx.com: white small text needs 4.5:1
    <footer className="bg-ax-teal-dark text-white">
      <div className="mx-auto max-w-6xl px-4 pb-8 pt-12 sm:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            {/* The operator line below names the company already */}
            <AxLogo name={tb('name')} tone="dark" />
            <p className="text-sm font-bold">{t('operator')}</p>
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-3 text-sm font-bold">
            {links.map(({ href, label }) => (
              <li key={href}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  {label}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">{t('newTab')}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        <hr className="mt-10 border-white/60" />
        {/* Rendered per request (the page is dynamic); recheck the year if it becomes static */}
        <p className="mt-6 text-right font-ax-latin">
          <small className="text-xs">{t('copyright', { year: new Date().getFullYear() })}</small>
        </p>
      </div>
    </footer>
  );
}
