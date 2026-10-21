import { LeadHandoffSheet } from '@/components/features/lead-handoff/lead-handoff-sheet';
import { getTranslations } from 'next-intl/server';

interface LeadHandoffPageProps {
  params: Promise<{ locale: string; leadId: string }>;
}

export async function generateMetadata({ params }: LeadHandoffPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'leadHandoff' });
  return { title: `${t('title')} - DiagnoLeads` };
}

/** Handoff sheet of the first meeting, to open and print (Refs #86) */
export default async function LeadHandoffPage({ params }: LeadHandoffPageProps) {
  const { leadId } = await params;
  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <LeadHandoffSheet leadId={leadId} />
    </div>
  );
}
