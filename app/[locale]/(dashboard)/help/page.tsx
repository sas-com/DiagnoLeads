import { HelpCenter } from '@/components/features/help/help-center';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'help.center' });
  return { title: `${t('title')} - DiagnoLeads` };
}

/** The help center: contents, search, workflows and glossary (Epic #877, #874) */
export default function HelpPage() {
  return <HelpCenter />;
}
