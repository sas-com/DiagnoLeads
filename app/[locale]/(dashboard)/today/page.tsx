import { TodayScreen } from '@/components/features/today/today-screen';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'today' });
  return { title: `${t('title')} - DiagnoLeads` };
}

/** The signed-in member's day: next actions, meetings, today's contacts and deals (Refs #556) */
export default function TodayPage() {
  return <TodayScreen />;
}
