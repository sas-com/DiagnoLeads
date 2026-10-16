'use client';

/**
 * What the lead list shows when the page has no rows, in the table and in the card list (#110):
 * "nothing matches" with a way to clear the filters, or "no leads yet".
 */
import { Button } from '@/components/ui/button';
import { UserPlus, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface LeadListEmptyProps {
  /** Filters are applied: an empty page means "no match", not "no leads yet" */
  hasFilters: boolean;
  onClearFilters?: () => void;
}

export function LeadListEmpty({ hasFilters, onClearFilters }: LeadListEmptyProps) {
  const t = useTranslations('leads');
  const tList = useTranslations('leadList');

  if (hasFilters) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center text-gray-500 dark:text-gray-400">
        <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {tList('noMatches')}
        </p>
        <p className="text-sm">{tList('noMatchesDescription')}</p>
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
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-50 to-violet-50 dark:from-blue-900/30 dark:to-violet-900/30">
        <Users className="h-10 w-10 text-blue-400 dark:text-blue-300" />
      </div>
      <p className="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">{t('noLeads')}</p>
      <p className="mb-6 max-w-sm text-sm text-gray-500 dark:text-gray-400">
        {t('noLeadsDescription')}
      </p>
      <Button size="lg">
        <UserPlus className="mr-2 h-5 w-5" />
        {t('addFirstLead')}
      </Button>
    </div>
  );
}
