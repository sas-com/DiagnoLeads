import { AxFloatingCta } from '@/components/features/ax-site/ax-floating-cta';
import { AxLandingOnly, AxLandingView } from '@/components/features/ax-site/ax-landing-view';
import { AxSiteShell } from '@/components/features/ax-site/ax-site-shell';
import {
  AxChallenges,
  AxDemo,
  AxDiagnosisSection,
  AxFaq,
  AxFinalCta,
  AxHero,
  AxHostPlatforms,
  AxOverview,
  AxReasons,
  AxSteps,
  AxTargets,
  AxTrust,
} from '@/components/features/ax-site/landing-sections';
import { axShareImage } from '@/lib/features/ax-site/share-images';
import { robotsFor } from '@/lib/seo/indexing';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

interface AxMigrationPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: AxMigrationPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'axSite.meta' });
  const messages = await getTranslations({ locale });
  // Share image (#344): the hero heading, also its alt text
  const image = axShareImage('ax-migration', locale, messages('axSite.hero.title'));
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
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
      images: [image],
    },
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
    <AxSiteShell locale={locale} variant="landing" page="ax-lp">
      {/* Once the result is shown, it replaces the rest of the page (#280) */}
      <AxLandingView>
        <AxLandingOnly>
          {/* Order of the STUDIO design (#414), with the systems and the diagnosis added */}
          <AxHero locale={locale} />
          <AxOverview locale={locale} />
          <AxChallenges locale={locale} />
          <AxReasons locale={locale} />
          <AxDemo locale={locale} />
          <AxSteps locale={locale} />
          <AxTargets locale={locale} />
          {/* AS/400 and ACOS, each with its own heading (#311) */}
          <AxHostPlatforms locale={locale} />
          {/* Reassurance right before the diagnosis asks for contact details */}
          <AxTrust locale={locale} />
        </AxLandingOnly>
        <AxDiagnosisSection locale={locale} />
        <AxLandingOnly>
          <AxFaq locale={locale} />
          <AxFinalCta locale={locale} />
          <AxFloatingCta label={t('floatingCta')} />
        </AxLandingOnly>
      </AxLandingView>
    </AxSiteShell>
  );
}
