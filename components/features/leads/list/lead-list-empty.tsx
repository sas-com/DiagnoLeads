'use client';

/**
 * What the lead list shows when the page has no rows, in the table and in the card list (#110):
 * "nothing matches" with a way to clear the filters, "no leads yet", or that the list could not
 * be loaded, with a retry (#431).
 */
import { InlineLoadError } from '@/components/common/inline-load-error';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { UserPlus, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface LeadListEmptyProps {
  /** Filters are applied: an empty page means "no match", not "no leads yet" */
  hasFilters: boolean;
  onClearFilters?: () => void;
  /**
   * What to say when nothing matches, in place of the generic text: the list filtered to the
   * leads missing a deal only says there are none left (#854)
   */
  noMatchesTitle?: string;
  /** The list request failed: an error, not "no leads yet" */
  loadFailed?: boolean;
  onRetry?: () => void;
  /** Opens the create dialog from "no leads yet"; without it (no permission) there is no button */
  onCreate?: () => void;
}

export function LeadListEmpty({
  hasFilters,
  onClearFilters,
  noMatchesTitle,
  loadFailed = false,
  onRetry,
  onCreate,
}: LeadListEmptyProps) {
  const t = useTranslations('leads');
  const tList = useTranslations('leadList');

  if (loadFailed) {
    return <InlineLoadError onRetry={onRetry} className="mx-auto max-w-md" />;
  }

  if (hasFilters) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center text-gray-500 dark:text-gray-400">
        <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {noMatchesTitle ?? tList('noMatches')}
        </p>
        {!noMatchesTitle && <p className="text-sm">{tList('noMatchesDescription')}</p>}
        {onClearFilters && (
          <Button variant="outline" className="h-11 md:h-10" onClick={onClearFilters}>
            {tList('chips.clearAll')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-8 text-center text-gray-500 dark:text-gray-400">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full border border-brand-200 bg-brand-50 dark:border-gray-700 dark:bg-gray-800">
        <Users className="h-10 w-10 text-brand-400" />
      </div>
      <p className="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">{t('noLeads')}</p>
      <p className={cn('max-w-sm text-sm text-gray-500 dark:text-gray-400', onCreate && 'mb-6')}>
        {t('noLeadsDescription')}
      </p>
      {onCreate && (
        <Button size="lg" onClick={onCreate}>
          <UserPlus className="mr-2 h-5 w-5" />
          {t('addFirstLead')}
        </Button>
      )}
    </div>
  );
}
