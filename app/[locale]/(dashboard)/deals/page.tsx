import { DealsScreen } from '@/components/features/deals/deals-screen';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'deals' });
  return { title: `${t('title')} - DiagnoLeads` };
}

/** The deals: pipeline board and list (Refs #436). The filters live in the URL. */
export default function DealsPage() {
  return (
    <Suspense>
      <DealsScreen />
    </Suspense>
  );
}
