import { DealDetailView } from '@/components/features/deals/deal-detail-view';
import { getTranslations } from 'next-intl/server';

interface DealPageProps {
  params: Promise<{ locale: string; dealId: string }>;
}

export async function generateMetadata({ params }: DealPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'deals' });
  return { title: `${t('title')} - DiagnoLeads` };
}

/** One deal: its stage path, values and history (Refs #436) */
export default async function DealPage({ params }: DealPageProps) {
  const { dealId } = await params;
  return (
    <div className="container mx-auto px-0 py-2 sm:px-4 sm:py-6">
      <DealDetailView dealId={dealId} />
    </div>
  );
}
