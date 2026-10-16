'use client';

import { Badge } from '@/components/ui/badge';
import type { Lead, Tag } from '@/lib/db/schema';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId } from 'react';
import { LeadAssigneeSelect } from './lead-assignee-select';
import { LeadQuickSelect } from './lead-quick-select';
import { NextMeetingCell } from './next-meeting';

/** A row of leads.list: the lead with its tags, last activity, assignee and latest hearing */
export type LeadListRow = Lead & {
  tags?: Tag[];
  lastActivityAt?: Date | string | null;
  /** The assignee (#135) */
  assignee?: { id: string; name: string | null; email: string } | null;
  /** From the latest hearing (#137) */
  nextMeetingDate?: string | null;
  dealRating?: string | null;
};

/** 'YYYY/MM/DD' in Japan time */
const jstDayFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// The in-place selects are 44px tall on the card, so a finger hits them (#110)
const TAP_SELECT = 'h-11 px-3 text-sm';

interface LeadCardProps {
  lead: LeadListRow;
  /** The lead page; tapping the card opens it */
  href?: string;
  /** Without href, tapping the card calls this instead */
  onOpen?: () => void;
  organizationId: string;
  /** Status, phase and assignee change in place; read-only roles get plain badges */
  canEdit: boolean;
  /** Called after the status was changed to lost */
  onLost?: () => void;
}

/**
 * One lead of the list on a phone (below md, #110). The company leads (the person under it);
 * status, phase and assignee change in place without opening the lead. The rest of the card
 * is one link to the lead page: its ::after covers the card, and the selects sit above it.
 */
export function LeadCard({ lead, href, onOpen, organizationId, canEdit, onLost }: LeadCardProps) {
  const t = useTranslations('leads');
  const tList = useTranslations('leadList');
  const tCards = useTranslations('leadList.cards');
  const tAssignee = useTranslations('leadAssignee');
  const personId = useId();

  const person = lead.name || null;
  const primary = lead.company || person || lead.email || t('nameNotSet');
  // Under the company: the person, or the email when there is no name
  const secondary = lead.company ? person || lead.email : person ? lead.email : null;
  const label = [primary, lead.company ? person : null].filter(Boolean).join(' ');
  const editable = canEdit && !!organizationId;
  const hasScore = typeof lead.score === 'number';
  const consultation = lead.conversionPoint === 'consultation';

  // Covers the whole card; the focus ring is drawn on the cover
  const coverClass =
    "rounded-sm after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-brand-500";

  return (
    <li
      aria-label={label}
      className="relative px-4 py-4 transition-colors hover:bg-blue-50/60 dark:hover:bg-gray-700/50"
      data-testid="lead-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">
            {href ? (
              <Link
                href={href}
                className={coverClass}
                aria-describedby={secondary ? personId : undefined}
              >
                {primary}
              </Link>
            ) : (
              <button
                type="button"
                onClick={onOpen}
                className={cn(coverClass, 'text-left')}
                aria-describedby={secondary ? personId : undefined}
              >
                {primary}
              </button>
            )}
          </h3>
          {secondary && (
            <p id={personId} className="truncate text-sm text-gray-600 dark:text-gray-300">
              {secondary}
            </p>
          )}
        </div>
        {hasScore && (
          <p className="shrink-0 text-right leading-none" data-testid="lead-card-score">
            <span className="sr-only">{t('score')} </span>
            <span className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
              {lead.score}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">/100</span>
          </p>
        )}
      </div>

      {/* Above the card's link: changing a value does not open the lead */}
      <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2">
        <LeadQuickSelect
          field="status"
          lead={lead}
          organizationId={organizationId}
          canEdit={editable}
          onLost={onLost}
          className={editable ? TAP_SELECT : undefined}
        />
        {(lead.dealPhase || editable) && (
          <LeadQuickSelect
            field="dealPhase"
            lead={lead}
            organizationId={organizationId}
            canEdit={editable}
            className={editable ? TAP_SELECT : undefined}
          />
        )}
        {lead.mqlQualifiedAt && (
          <Badge
            color="emerald"
            title={tCards('mqlSince', {
              date: jstDayFormat.format(new Date(lead.mqlQualifiedAt)),
            })}
          >
            {tList('mql')}
          </Badge>
        )}
        {consultation && <Badge color="violet">{tList('consultation')}</Badge>}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <div className="min-w-0">
          <dt className="text-xs text-gray-500 dark:text-gray-400">{tAssignee('label')}</dt>
          <dd className="relative z-10 min-w-0">
            <LeadAssigneeSelect
              lead={lead}
              organizationId={organizationId}
              canEdit={editable}
              className={editable ? '-ml-1.5 h-11 max-w-full' : 'min-h-11'}
            />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-gray-500 dark:text-gray-400">{tList('nextMeeting')}</dt>
          <dd className="flex min-h-11 items-center">
            {/* The overdue badge goes under the date when the column is narrow */}
            <NextMeetingCell
              date={lead.nextMeetingDate}
              status={lead.status}
              className="flex-wrap gap-x-2 gap-y-1"
            />
          </dd>
        </div>
      </dl>
    </li>
  );
}
