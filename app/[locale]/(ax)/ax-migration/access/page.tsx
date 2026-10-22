import {
  ACCESS_FAQ_KEYS,
  AxAccessDiagnosisSection,
  AxAccessHero,
  AxAccessPaths,
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
import { AxFaq, AxFinalCta } from '@/components/features/ax-site/landing-sections';
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
    },
    twitter: { card: 'summary', title: t('title'), description: t('description') },
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

  return (
    <AxSiteShell locale={locale} variant="landing">
      {/* Once the result is shown, it replaces the rest of the page (#280) */}
      <AxLandingView>
        <AxLandingOnly>
          <AxAccessHero locale={locale} />
          <AxAccessSupportEnd locale={locale} />
          <AxAccessProblems locale={locale} />
          <AxAccessRisks locale={locale} />
          <AxAccessPaths locale={locale} />
          <AxAccessSteps locale={locale} />
          <AxAccessTargets locale={locale} />
          <AxFaq locale={locale} namespace="axAccess.faq" keys={ACCESS_FAQ_KEYS} />
        </AxLandingOnly>
        <AxAccessDiagnosisSection locale={locale} />
        <AxLandingOnly>
          <AxFinalCta locale={locale} copyNamespace="axAccess.finalCta" locationPrefix="access-" />
          <AxFloatingCta label={t('floatingCta')} />
        </AxLandingOnly>
      </AxLandingView>
      <AxAccessTrademark locale={locale} />
    </AxSiteShell>
  );
}
