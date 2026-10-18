'use client';

import { Badge } from '@/components/ui/badge';
import type { AxMqlLevel } from '@/lib/features/diagnostics/ax-migration/mql';
import { useTranslations } from 'next-intl';

/** 'YYYY/MM/DD' in Japan time */
const jstDayFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

interface LeadMqlBadgesProps {
  /** From leads.list (leadMqlLevel); null or undefined without diagnosis data */
  level?: AxMqlLevel | null;
  /** The lead's MQL date, shown as the badge's tooltip */
  qualifiedAt?: Date | string | null;
}

/**
 * MQL badges of a lead in the list (#196), the same words as the lead page:
 * - 関心あり（MQL） (emerald) for the interest level
 * - "MQL" (emerald) when the lead has an MQL date without the interest level (e.g. set by hand)
 * - 適合 (gray) for the fit level
 * Nothing for 対象外 or no data. The MQL date is the tooltip of the emerald badge.
 */
export function LeadMqlBadges({ level, qualifiedAt }: LeadMqlBadgesProps) {
  const tList = useTranslations('leadList');
  const tLevels = useTranslations('leadActivity.summary.mqlLevels');
  const since = qualifiedAt
    ? tList('cards.mqlSince', { date: jstDayFormat.format(new Date(qualifiedAt)) })
    : undefined;

  return (
    <>
      {level === 'interest' ? (
        <Badge color="emerald" title={since} data-testid="lead-mql-badge">
          {tLevels('interest')}
        </Badge>
      ) : (
        qualifiedAt && (
          <Badge color="emerald" title={since} data-testid="lead-mql-badge">
            {tList('mql')}
          </Badge>
        )
      )}
      {level === 'fit' && (
        <Badge color="gray" data-testid="lead-mql-fit-badge">
          {tLevels('fit')}
        </Badge>
      )}
    </>
  );
}
