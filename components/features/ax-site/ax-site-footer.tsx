import { isColumnLocale } from '@/lib/features/ax-site/columns';
import { COLUMN_INDEX_PATH } from '@/lib/features/ax-site/columns/types';
import { ExternalLink } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AxCrossLink } from './ax-cross-link';
import { AxLogo } from './ax-logo';
import { AX_FOOTER_ID, AX_SITE_LINKS, axPrivacyPolicyUrl } from './site-config';

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
  // Pages of this site, reachable from every page also on phones (the header menu is hidden
  // there); columns exist in Japanese only, so no link to a page that would 404 (#332)
  const sitePages = [
    { href: `/${locale}/ax-migration`, label: t('sitePages.top') },
    { href: `/${locale}/ax-migration/access`, label: t('sitePages.access') },
    ...(isColumnLocale(locale)
      ? [{ href: `/${locale}${COLUMN_INDEX_PATH}`, label: t('sitePages.column') }]
      : []),
  ];

  return (
    // The rule on top parts it from the final call to action, which has the same forest
    <footer id={AX_FOOTER_ID} className="border-t border-white/25 bg-ax-forest text-white">
      <div className="mx-auto max-w-6xl px-4 pb-8 pt-12 sm:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            <AxLogo alt={tb('logoAlt')} tone="dark" />
            <p className="text-sm font-bold">{t('operator')}</p>
            <address className="text-xs not-italic text-white/90">{t('address')}</address>
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
        <nav aria-label={t('sitePages.label')} className="mt-8">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-bold">
            {sitePages.map(({ href, label }) => (
              <li key={href}>
                <AxCrossLink
                  href={href}
                  placement="footer"
                  className="inline-block rounded py-1 underline underline-offset-4 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  {label}
                </AxCrossLink>
              </li>
            ))}
          </ul>
        </nav>
        <hr className="mt-8 border-white/60" />
        {/* Rendered per request (the page is dynamic); recheck the year if it becomes static */}
        <p className="mt-6 text-right">
          <small className="text-xs">{t('copyright', { year: new Date().getFullYear() })}</small>
        </p>
      </div>
    </footer>
  );
}
