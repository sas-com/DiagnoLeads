import { DiagnosticForm } from '@/components/features/diagnostic/diagnostic-form';
import { isLegacyDiagnosticFormEnabled } from '@/lib/features/diagnostics/legacy-form';
import { supportedLocaleOr } from '@/lib/i18n/config';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

/**
 * Diagnostic Page Metadata
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'public.diagnostic' });

  return {
    title: t('meta.title'),
    description: t('meta.description'),
  };
}

/**
 * Diagnostic Page: the generic diagnostic form. The CMS no longer holds diagnostic forms
 * (#413), so this always shows the built-in form.
 */
export default async function DiagnosticPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Off in production (#71): send visitors to the AX diagnosis instead
  if (!isLegacyDiagnosticFormEnabled()) redirect(`/${supportedLocaleOr(locale)}/ax-diagnosis`);
  const t = await getTranslations('public.diagnostic');

  return (
    <div className="min-h-screen py-12 lg:py-20">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">{t('title')}</h1>
            <p className="text-lg text-gray-600">{t('subtitle')}</p>
          </div>

          <DiagnosticForm locale={locale} />
        </div>
      </div>
    </div>
  );
}
