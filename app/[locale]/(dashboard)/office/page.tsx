import { OfficeScreen } from '@/components/features/ai-employees/office-screen';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'aiOffice' });
  return { title: `${t('title')} - DiagnoLeads` };
}

/** The AI employees at their desks (Refs #1101, Epic #1100) */
export default function OfficePage() {
  return <OfficeScreen />;
}
