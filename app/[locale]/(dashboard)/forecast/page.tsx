import { ForecastScreen } from '@/components/features/sales-forecast/forecast-screen';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'salesForecast' });
  return { title: `${t('title')} - DiagnoLeads` };
}

/** The forecast against the targets and the week's pipeline changes (Refs #437) */
export default function ForecastPage() {
  return (
    <Suspense>
      <ForecastScreen />
    </Suspense>
  );
}
