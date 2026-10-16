import { LeadDetailView } from '@/components/features/leads/detail/lead-detail-view';
import {
  type LeadCardField,
  cardOfField,
  isLeadCardId,
  isLeadTab,
} from '@/lib/features/leads/detail-fields';
import { getTranslations } from 'next-intl/server';

type SearchParam = string | string[] | undefined;

interface LeadPageProps {
  params: Promise<{ locale: string; leadId: string }>;
  searchParams: Promise<{
    tab?: SearchParam;
    edit?: SearchParam;
    field?: SearchParam;
    submission?: SearchParam;
    record?: SearchParam;
  }>;
}

const first = (value: SearchParam) => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata({ params }: LeadPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'leads' });
  return { title: `${t('leadDetails')} - DiagnoLeads` };
}

/**
 * The lead page (Refs #108). The tab is in the URL (?tab=); ?edit=<card>[&field=<field>] opens
 * a card for editing (the list's row menu), ?submission= shows a diagnosis' answers and
 * ?record=1 starts recording a hearing (the list's side panel).
 */
export default async function LeadPage({ params, searchParams }: LeadPageProps) {
  const { leadId } = await params;
  const query = await searchParams;
  const tab = first(query.tab);
  const edit = first(query.edit);
  const field = first(query.field);
  const fieldCard = field ? cardOfField(field) : null;

  return (
    <div className="container mx-auto max-w-6xl px-0 py-2 sm:px-4 sm:py-6">
      <LeadDetailView
        leadId={leadId}
        initialTab={isLeadTab(tab) ? tab : 'overview'}
        initialEdit={isLeadCardId(edit) ? edit : null}
        initialField={isLeadCardId(edit) && fieldCard === edit ? (field as LeadCardField) : null}
        initialSubmissionId={first(query.submission) ?? null}
        initialRecord={first(query.record) === '1'}
      />
    </div>
  );
}
