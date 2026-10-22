import { AxSiteShell } from '@/components/features/ax-site/ax-site-shell';
import { UnsubscribePanel } from '@/components/features/respondent-email/unsubscribe-panel';
import { axSenderIdentity } from '@/lib/features/ax-site/sender-identity';
import { NOINDEX } from '@/lib/seo/indexing';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

interface UnsubscribePageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: UnsubscribePageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'axDiagnosis.emailUnsubscribe.meta' });
  return {
    title: { absolute: t('title') },
    description: null,
    keywords: null,
    // Reached only from a mail; the token is in the fragment, and no Referer leaves the page
    robots: NOINDEX,
    referrer: 'no-referrer',
  };
}

/**
 * Unsubscribe page of the respondent mail (#154), linked from the footer of every mail as
 * /{locale}/email/unsubscribe#t=<token>. Opening it changes nothing; the button does
 * (POST /api/email/unsubscribe). Public: no sign-in.
 */
export default async function UnsubscribePage({ params }: UnsubscribePageProps) {
  const { locale: requested } = await params;
  const locale = requested === 'en' ? 'en' : 'ja';
  const sender = axSenderIdentity(locale);
  return (
    <AxSiteShell locale={locale} variant="standalone" analytics={false}>
      <div className="bg-gradient-to-b from-white to-ax-mist">
        <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
          <div className="rounded-3xl bg-white p-5 shadow-[0_10px_40px_rgba(0,0,0,0.08)] ring-1 ring-black/5 sm:p-10">
            <UnsubscribePanel
              contact={{
                name: `${sender.operatorName} ${sender.department}`,
                email: sender.email,
                phone: sender.phone,
              }}
            />
          </div>
        </div>
      </div>
    </AxSiteShell>
  );
}
