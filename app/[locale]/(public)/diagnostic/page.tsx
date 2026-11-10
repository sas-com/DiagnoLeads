import { supportedLocaleOr } from '@/lib/i18n/config';
import { redirect } from 'next/navigation';

interface DiagnosticPageProps {
  params: Promise<{ locale: string }>;
}

/**
 * The legacy generic diagnosis form is gone (#470). The top and landing pages still link here, so
 * the address leads to the AX diagnosis, where production already sent it.
 */
export default async function DiagnosticPage({ params }: DiagnosticPageProps) {
  const { locale } = await params;
  redirect(`/${supportedLocaleOr(locale)}/ax-diagnosis`);
}
