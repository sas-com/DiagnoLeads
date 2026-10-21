import { allowedEmailDomains, isTestMode } from '@/lib/email/allowed-recipients';
import { formatEmailDomains } from '@/lib/i18n/format-domains';
import { getTranslations } from 'next-intl/server';
import { AxCtaLink } from './ax-cta-link';
import { AxLogo } from './ax-logo';
import { AX_SECTIONS } from './site-config';

export type AxSiteVariant = 'landing' | 'standalone';

interface AxSiteHeaderProps {
  locale: string;
  /** On the landing page the links scroll; elsewhere they open the landing page sections */
  variant: AxSiteVariant;
}

const NAV_ITEMS = ['problems', 'steps', 'targets', 'faq'] as const;

export async function AxSiteHeader({ locale, variant }: AxSiteHeaderProps) {
  const t = await getTranslations({ locale, namespace: 'axSite' });
  const landingPath = `/${locale}/ax-migration`;
  const sectionHref = (id: string) => (variant === 'landing' ? `#${id}` : `${landingPath}#${id}`);
  const tc = await getTranslations({ locale, namespace: 'common.testMode' });
  const testModeDomains = formatEmailDomains(allowedEmailDomains(), locale);

  return (
    <>
      {/* Above the sticky header and scrolling away with the page: the header itself stays
          lower than html scroll-padding-top (5rem), so headings scrolled to are never under it */}
      {isTestMode() && (
        // biome-ignore lint/a11y/useSemanticElements: test-mode banner as a live region, not the result of a form calculation
        <p
          role="status"
          className="bg-amber-100 px-4 py-1.5 text-center text-xs font-bold text-amber-900"
        >
          {tc('banner', {
            label: tc('label'),
            description: tc('description', { domains: testModeDomains }),
          })}
        </p>
      )}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:gap-4 sm:px-6">
          <a
            href={variant === 'landing' ? '#top' : landingPath}
            aria-label={t('header.home')}
            className="rounded focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-ax-teal-dark"
          >
            <AxLogo name={t('brand.name')} operator={t('brand.operator')} />
          </a>
          <nav
            aria-label={t('header.navLabel')}
            className="hidden items-center gap-7 text-sm font-bold lg:flex"
          >
            {NAV_ITEMS.map((id) => (
              <a
                key={id}
                href={sectionHref(AX_SECTIONS[id])}
                className="text-ax-ink transition-colors hover:text-ax-teal-dark"
              >
                {t(`header.nav.${id}`)}
              </a>
            ))}
          </nav>
          <AxCtaLink
            href={sectionHref(AX_SECTIONS.diagnosis)}
            location="header"
            // Fits next to the logo down to 320px wide
            className="px-4 py-2.5 text-sm max-[359px]:gap-1 max-[359px]:px-3 max-[359px]:text-xs max-[359px]:[&>svg]:hidden sm:px-5"
          >
            {t('header.cta')}
          </AxCtaLink>
        </div>
      </header>
    </>
  );
}
