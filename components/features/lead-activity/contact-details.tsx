'use client';

import { durationParts } from '@/components/features/lead-follow-up/contact-format';
import type { ContactRecordedEvent } from '@/lib/features/lead-activity/types/schemas';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

/**
 * What a contact record adds to its title (Refs #554): how long it took, how it left the sale
 * and the deal it was about (a link to the deal). Nothing when none of them was given.
 */
export function ContactDetails({ event }: { event: ContactRecordedEvent }) {
  const t = useTranslations('leadFollowUp');
  const locale = useLocale();
  const parts: { key: string; node: ReactNode }[] = [];
  if (event.durationMinutes !== null) {
    parts.push({ key: 'duration', node: t('duration', durationParts(event.durationMinutes)) });
  }
  if (event.outcome) {
    parts.push({
      key: 'outcome',
      node: t('outcomeLabel', { outcome: t(`outcomes.${event.outcome}`) }),
    });
  }
  if (event.deal) {
    parts.push({
      key: 'deal',
      node: (
        <Link
          href={`/${locale}/deals/${event.deal.id}`}
          className="min-w-0 truncate text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {t('dealLink', { name: event.deal.name })}
        </Link>
      ),
    });
  }
  if (parts.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {index > 0 && <span aria-hidden="true">·</span>}
          {typeof part.node === 'string' ? <span>{part.node}</span> : part.node}
        </Fragment>
      ))}
    </p>
  );
}
