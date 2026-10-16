'use client';

/**
 * The lead list on a phone (below md, #110): one card per lead of the page leads.list returned,
 * in the server's order. Filters, sort and paging stay with the table's toolbar and footer.
 */
import { useTranslations } from 'next-intl';
import { LeadCard, type LeadListRow } from '../lead-card';
import { LeadListEmpty } from './lead-list-empty';

export interface LeadCardListProps {
  leads: LeadListRow[];
  /** The lead page of a lead; the card opens it */
  getLeadHref?: (lead: LeadListRow) => string;
  /** Without getLeadHref, a tapped card calls this */
  onLeadClick?: (lead: LeadListRow) => void;
  organizationId?: string;
  canEdit?: boolean;
  onLost?: (lead: LeadListRow) => void;
  hasFilters?: boolean;
  onClearFilters?: () => void;
}

export function LeadCardList({
  leads,
  getLeadHref,
  onLeadClick,
  organizationId,
  canEdit = false,
  onLost,
  hasFilters = false,
  onClearFilters,
}: LeadCardListProps) {
  const t = useTranslations('leadList.cards');

  if (leads.length === 0) {
    return (
      <div className="px-4 py-8">
        <LeadListEmpty hasFilters={hasFilters} onClearFilters={onClearFilters} />
      </div>
    );
  }

  return (
    <ul aria-label={t('label')} className="divide-y divide-gray-200 dark:divide-gray-700">
      {leads.map((lead) => (
        <LeadCard
          key={lead.id}
          lead={lead}
          href={getLeadHref?.(lead)}
          onOpen={() => onLeadClick?.(lead)}
          organizationId={organizationId ?? ''}
          canEdit={canEdit}
          onLost={() => onLost?.(lead)}
        />
      ))}
    </ul>
  );
}
