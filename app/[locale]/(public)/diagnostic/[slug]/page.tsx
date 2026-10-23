import { supportedLocaleOr } from '@/lib/i18n/config';
import { redirect } from 'next/navigation';

interface DiagnosticSlugPageProps {
  params: Promise<{ locale: string }>;
}

/**
 * The CMS diagnostic forms are gone (#413). An address shared earlier still leads somewhere: the
 * AX diagnosis, where production already sent it.
 */
export default async function DiagnosticSlugPage({ params }: DiagnosticSlugPageProps) {
  const { locale } = await params;
  redirect(`/${supportedLocaleOr(locale)}/ax-diagnosis`);
}
