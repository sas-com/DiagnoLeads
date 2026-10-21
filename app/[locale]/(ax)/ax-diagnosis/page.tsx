import { AxDiagnosisFlow } from '@/components/features/ax-diagnosis/ax-diagnosis-flow';
import { AxSiteShell } from '@/components/features/ax-site/ax-site-shell';
import { axPrivacyPolicyUrl } from '@/components/features/ax-site/site-config';
import { allowedEmailDomains } from '@/lib/email/allowed-recipients';
import { turnstileSiteKey } from '@/lib/features/diagnostics/turnstile';
import { robotsFor } from '@/lib/seo/indexing';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

interface AxDiagnosisPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: AxDiagnosisPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'axDiagnosis.meta' });
  const site = await getTranslations({ locale, namespace: 'axSite.meta' });
  return {
    title: { absolute: t('title') },
    description: t('description'),
    // This page, not the DiagnoLeads home, and the operator rather than DiagnoLeads
    alternates: {
      canonical: `/${locale}/ax-diagnosis`,
      languages: { ja: '/ja/ax-diagnosis', en: '/en/ax-diagnosis' },
    },
    authors: [{ name: site('siteName') }],
    creator: site('siteName'),
    keywords: null,
    openGraph: {
      type: 'website',
      title: t('title'),
      description: t('description'),
      siteName: site('siteName'),
    },
    twitter: { card: 'summary', title: t('title'), description: t('description') },
    // Indexed only after public launch (test mode off, which needs the publication approval)
    robots: robotsFor('/ax-diagnosis'),
  };
}

/**
 * AX migration self-diagnosis on its own page (for links from mail, DM and the sales team).
 * Answers are evaluated on the server: POST /api/diagnostics/ax-migration
 */
export default async function AxDiagnosisPage({ params }: AxDiagnosisPageProps) {
  const { locale: requested } = await params;
  const locale = requested === 'en' ? 'en' : 'ja';
  return (
    <AxSiteShell locale={locale} variant="standalone">
      <div className="bg-gradient-to-b from-white to-ax-mist">
        <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
          <div className="rounded-3xl bg-white p-5 shadow-[0_10px_40px_rgba(0,0,0,0.08)] ring-1 ring-black/5 sm:p-10">
            <AxDiagnosisFlow
              locale={locale}
              privacyPolicyUrl={axPrivacyPolicyUrl()}
              turnstileSiteKey={turnstileSiteKey()}
              allowedEmailDomains={allowedEmailDomains()}
              entry="ax-diagnosis"
            />
          </div>
        </div>
      </div>
    </AxSiteShell>
  );
}
