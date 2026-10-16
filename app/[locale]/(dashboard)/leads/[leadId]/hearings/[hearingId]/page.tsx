import { LeadHearingEditor } from '@/components/features/lead-hearings/lead-hearing-editor';
import { getTranslations } from 'next-intl/server';

interface LeadHearingPageProps {
  params: Promise<{ locale: string; leadId: string; hearingId: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}

export async function generateMetadata({ params }: LeadHearingPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'leadHearings' });
  return { title: `${t('title')} - DiagnoLeads` };
}

/** First meeting hearing editor (Refs #84) */
export default async function LeadHearingPage({ params, searchParams }: LeadHearingPageProps) {
  const { leadId, hearingId } = await params;
  // ?view=summary opens the meeting summary (#97)
  const { view } = await searchParams;
  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <LeadHearingEditor
        leadId={leadId}
        hearingId={hearingId}
        initialView={view === 'summary' ? 'summary' : 'record'}
      />
    </div>
  );
}
