import { ResultEmailConfirmPanel } from '@/components/features/ax-diagnosis/result-email-confirm-panel';
import { AxSiteShell } from '@/components/features/ax-site/ax-site-shell';
import { axSenderIdentity } from '@/lib/features/ax-site/sender-identity';
import { AX_RESULT_EMAIL_CONFIRM_TTL_HOURS } from '@/lib/features/diagnostics/ax-migration/result-email-config';
import { NOINDEX } from '@/lib/seo/indexing';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

interface ResultEmailConfirmPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: ResultEmailConfirmPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'axDiagnosis.emailConfirm.meta' });
  return {
    title: { absolute: t('title') },
    description: null,
    keywords: null,
    // Reached only from the confirmation mail; the token is in the fragment, and no Referer
    // leaves the page
    robots: NOINDEX,
    referrer: 'no-referrer',
  };
}

/**
 * Confirm page of the AX result by email (#154), linked from the confirmation mail as
 * /{locale}/ax-diagnosis/email/confirm#t=<token>. Opening it changes nothing; its buttons do
 * (POST /api/diagnostics/ax-migration/result-email/confirm). Public: no sign-in, no analytics.
 */
export default async function ResultEmailConfirmPage({ params }: ResultEmailConfirmPageProps) {
  const { locale: requested } = await params;
  const locale = requested === 'en' ? 'en' : 'ja';
  const sender = axSenderIdentity(locale);
  return (
    <AxSiteShell locale={locale} variant="standalone" analytics={false}>
      <div className="bg-gradient-to-b from-white to-ax-mist">
        <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
          <div className="rounded-3xl bg-white p-5 shadow-[0_10px_40px_rgba(0,0,0,0.08)] ring-1 ring-black/5 sm:p-10">
            <ResultEmailConfirmPanel
              contact={{
                name: `${sender.operatorName} ${sender.department}`,
                email: sender.email,
                phone: sender.phone,
              }}
              hours={AX_RESULT_EMAIL_CONFIRM_TTL_HOURS}
            />
          </div>
        </div>
      </div>
    </AxSiteShell>
  );
}
