import { allowedEmailDomains, isTestMode } from '@/lib/email/allowed-recipients';
import { isColumnLocale } from '@/lib/features/ax-site/columns';
import { COLUMN_INDEX_PATH } from '@/lib/features/ax-site/columns/types';
import { formatEmailDomains } from '@/lib/i18n/format-domains';
import { getTranslations } from 'next-intl/server';
import { AxCtaLink } from './ax-cta-link';
import { AxLogo } from './ax-logo';
import { type AxMenuItem, AxMobileMenu } from './ax-mobile-menu';
import { AX_SECTIONS } from './site-config';

export type AxSiteVariant = 'landing' | 'standalone';
/** Landing pages the header menu leaves out a link to, on the page itself */
export type AxLandingPage = 'ax-lp' | 'ax-access-lp';

/** Diagnosis button of the header leading elsewhere than the main page's diagnosis */
export interface AxHeaderCta {
  href: string;
  label: string;
}

export interface AxSiteHeaderProps {
  locale: string;
  /** On the landing page the links scroll; elsewhere they open the landing page sections */
  variant: AxSiteVariant;
  /** e.g. the Access diagnosis on the Access columns (#332) */
  cta?: AxHeaderCta;
  /** Name of the logo link when it does not lead to the main page (e.g. #top of another page) */
  logoLabel?: string;
  /** The landing page shown, if any: the phone menu links to the other one instead */
  page?: AxLandingPage;
}

type NavItem = 'problems' | 'reasons' | 'demo' | 'steps' | 'targets' | 'faq';
const NAV_ITEMS: readonly NavItem[] = ['problems', 'reasons', 'demo', 'steps', 'targets', 'faq'];
/** The Access page has no reasons or demo section of its own */
const ACCESS_NAV_ITEMS: readonly NavItem[] = ['problems', 'steps', 'targets', 'faq'];

export async function AxSiteHeader({ locale, variant, cta, logoLabel, page }: AxSiteHeaderProps) {
  const t = await getTranslations({ locale, namespace: 'axSite' });
  const landingPath = `/${locale}/ax-migration`;
  const sectionHref = (id: string) => (variant === 'landing' ? `#${id}` : `${landingPath}#${id}`);
  const navItems = page === 'ax-access-lp' ? ACCESS_NAV_ITEMS : NAV_ITEMS;
  const tc = await getTranslations({ locale, namespace: 'common.testMode' });
  const testModeDomains = formatEmailDomains(allowedEmailDomains(), locale);
  // Phone menu (#332): the header links, then the pages of the site other than this one
  const menuItems: AxMenuItem[] = [
    ...navItems.map((id) => ({
      href: sectionHref(AX_SECTIONS[id]),
      label: t(`header.nav.${id}`),
    })),
    ...(isColumnLocale(locale)
      ? [{ href: `/${locale}${COLUMN_INDEX_PATH}`, label: t('header.nav.column') }]
      : []),
    ...(page === 'ax-lp' ? [] : [{ href: landingPath, label: t('header.menu.top') }]),
    ...(page === 'ax-access-lp'
      ? []
      : [{ href: `${landingPath}/access`, label: t('header.menu.access') }]),
  ];

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
        {/* Logo, CTA and menu button fit side by side down to 320px wide */}
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 max-[359px]:gap-1.5 max-[359px]:px-3 sm:gap-4 sm:px-6">
          <a
            href={variant === 'landing' ? '#top' : landingPath}
            aria-label={logoLabel ?? t('header.home')}
            className="shrink-0 rounded focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-ax-forest"
          >
            {/* The link names the logo */}
            <AxLogo alt="" narrow />
          </a>
          <nav
            aria-label={t('header.navLabel')}
            className="hidden items-center gap-5 text-sm font-bold lg:flex xl:gap-7"
          >
            {navItems.map((id) => (
              <a
                key={id}
                href={sectionHref(AX_SECTIONS[id])}
                className="text-ax-ink transition-colors hover:text-ax-leaf"
              >
                {t(`header.nav.${id}`)}
              </a>
            ))}
            {/* Columns exist in Japanese only: no link to a page that would 404 */}
            {isColumnLocale(locale) && (
              <a
                href={`/${locale}${COLUMN_INDEX_PATH}`}
                className="text-ax-ink transition-colors hover:text-ax-leaf"
              >
                {t('header.nav.column')}
              </a>
            )}
          </nav>
          <div className="flex items-center gap-2 max-[359px]:gap-1.5">
            <AxCtaLink
              href={cta?.href ?? sectionHref(AX_SECTIONS.diagnosis)}
              location="header"
              // Compact on phones, so it fits between the logo and the menu button down to 320px
              className="px-4 py-2.5 text-sm max-sm:gap-1 max-sm:px-3 max-sm:text-xs max-sm:[&>svg]:hidden sm:px-5"
            >
              {cta?.label ?? t('header.cta')}
            </AxCtaLink>
            <AxMobileMenu
              buttonLabel={t('header.menu.button')}
              navLabel={t('header.menu.navLabel')}
              items={menuItems}
            />
          </div>
        </div>
      </header>
    </>
  );
}
