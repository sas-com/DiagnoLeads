import { AxFloatingCta } from '@/components/features/ax-site/ax-floating-cta';
import { AxSiteShell } from '@/components/features/ax-site/ax-site-shell';
import {
  AxChallenges,
  AxDiagnosisSection,
  AxFaq,
  AxFinalCta,
  AxHero,
  AxProblems,
  AxReasons,
  AxSteps,
  AxTargets,
} from '@/components/features/ax-site/landing-sections';
import { robotsFor } from '@/lib/seo/indexing';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

interface AxMigrationPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: AxMigrationPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'axSite.meta' });
  return {
    title: { absolute: t('title') },
    description: t('description'),
    // This page, not the DiagnoLeads home, and the operator rather than DiagnoLeads
    alternates: {
      canonical: `/${locale}/ax-migration`,
      languages: { ja: '/ja/ax-migration', en: '/en/ax-migration' },
    },
    authors: [{ name: t('siteName') }],
    creator: t('siteName'),
    keywords: null,
    // Replace the DiagnoLeads defaults of the public layout: this is the operator's own site
    openGraph: {
      type: 'website',
      title: t('title'),
      description: t('description'),
      siteName: t('siteName'),
    },
    twitter: { card: 'summary', title: t('title'), description: t('description') },
    // Indexed only after public launch (test mode off, which needs the publication approval)
    robots: robotsFor('/ax-migration'),
  };
}

/**
 * AX migration landing page with the self-diagnosis embedded (#diagnosis)
 */
export default async function AxMigrationPage({ params }: AxMigrationPageProps) {
  const { locale: requested } = await params;
  const locale = requested === 'en' ? 'en' : 'ja';
  const t = await getTranslations({ locale, namespace: 'axSite' });

  return (
    <AxSiteShell locale={locale} variant="landing">
      <AxHero locale={locale} />
      <AxProblems locale={locale} />
      <AxChallenges locale={locale} />
      <AxSteps locale={locale} />
      <AxTargets locale={locale} />
      {/* Reasons first: reassurance before the diagnosis asks for contact details */}
      <AxReasons locale={locale} />
      <AxDiagnosisSection locale={locale} />
      <AxFaq locale={locale} />
      <AxFinalCta locale={locale} />
      <AxFloatingCta label={t('floatingCta')} />
    </AxSiteShell>
  );
}
