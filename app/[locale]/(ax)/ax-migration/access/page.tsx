import {
  ACCESS_FAQ_KEYS,
  AxAccessBreadcrumbs,
  AxAccessColumns,
  AxAccessDiagnosisSection,
  AxAccessHero,
  AxAccessHostSystems,
  AxAccessPaths,
  AxAccessPathsColumn,
  AxAccessProblems,
  AxAccessRisks,
  AxAccessSteps,
  AxAccessSupportEnd,
  AxAccessTargets,
  AxAccessTrademark,
} from '@/components/features/ax-site/access-sections';
import { AxFloatingCta } from '@/components/features/ax-site/ax-floating-cta';
import { AxLandingOnly, AxLandingView } from '@/components/features/ax-site/ax-landing-view';
import { AxSiteShell } from '@/components/features/ax-site/ax-site-shell';
import {
  AxConsultBand,
  AxFaq,
  AxFinalCta,
  AxTrust,
} from '@/components/features/ax-site/landing-sections';
import { axShareImage } from '@/lib/features/ax-site/share-images';
import { robotsFor } from '@/lib/seo/indexing';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

interface AxAccessPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: AxAccessPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'axAccess.meta' });
  const site = await getTranslations({ locale, namespace: 'axSite.meta' });
  const messages = await getTranslations({ locale });
  // Share image (#344): the hero heading, also its alt text
  const image = axShareImage('ax-access', locale, messages('axAccess.hero.title'));
  return {
    title: { absolute: t('title') },
    description: t('description'),
    // This page, not the DiagnoLeads home, and the operator rather than DiagnoLeads
    alternates: {
      canonical: `/${locale}/ax-migration/access`,
      languages: { ja: '/ja/ax-migration/access', en: '/en/ax-migration/access' },
    },
    authors: [{ name: site('siteName') }],
    creator: site('siteName'),
    keywords: null,
    // Replace the DiagnoLeads defaults of the public layout: this is the operator's own site
    openGraph: {
      type: 'website',
      title: t('title'),
      description: t('description'),
      siteName: site('siteName'),
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
      images: [image],
    },
    // Indexed only after public launch (test mode off, which needs the publication approval)
    robots: robotsFor('/ax-migration/access'),
  };
}

/**
 * Landing page for Microsoft Access tools (#296): fix, move to the web or replace, with the
 * diagnosis embedded (#diagnosis) and starting on the Access path
 */
export default async function AxAccessPage({ params }: AxAccessPageProps) {
  const { locale: requested } = await params;
  const locale = requested === 'en' ? 'en' : 'ja';
  const t = await getTranslations({ locale, namespace: 'axAccess' });
  const site = await getTranslations({ locale, namespace: 'axSite' });

  return (
    // The logo leads to the top of this page (#top), and is named so
    <AxSiteShell
      locale={locale}
      variant="landing"
      page="ax-access-lp"
      logoLabel={site('header.pageTop')}
    >
      {/* Once the result is shown, it replaces the rest of the page (#280) */}
      <AxLandingView>
        <AxLandingOnly>
          <AxAccessBreadcrumbs locale={locale} />
          <AxAccessHero locale={locale} />
          <AxAccessSupportEnd locale={locale} />
          <AxAccessProblems locale={locale} />
          <AxAccessRisks locale={locale} />
          <AxAccessPaths locale={locale} />
          <AxAccessPathsColumn locale={locale} />
          <AxAccessSteps locale={locale} />
          {/* The phone and the diagnosis halfway down the page, as on the main page (#425) */}
          <AxConsultBand
            locale={locale}
            copyNamespace="axAccess.consultBand"
            buttonsNamespace="axAccess.finalCta"
            locationPrefix="access-"
          />
          <AxAccessTargets locale={locale} />
          {/* Readers of AS/400 or ACOS: the main page's sections on their system */}
          <AxAccessHostSystems locale={locale} />
          <AxFaq locale={locale} namespace="axAccess.faq" keys={ACCESS_FAQ_KEYS} />
          {/* Reassurance right before the diagnosis asks for contact details, as on the main
              page; the scope card speaks of Access work */}
          <AxTrust locale={locale} scopeNamespace="axAccess.trustScope" />
        </AxLandingOnly>
        <AxAccessDiagnosisSection locale={locale} />
        <AxLandingOnly>
          <AxFinalCta locale={locale} copyNamespace="axAccess.finalCta" locationPrefix="access-" />
          {/* After the last call to action: no links away right before the diagnosis */}
          <AxAccessColumns locale={locale} />
          <AxFloatingCta label={t('floatingCta')} />
        </AxLandingOnly>
      </AxLandingView>
      <AxAccessTrademark locale={locale} />
    </AxSiteShell>
  );
}
