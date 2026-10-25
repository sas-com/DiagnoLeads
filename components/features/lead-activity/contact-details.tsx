'use client';

import type { ContactRecordedEvent } from '@/lib/features/lead-activity/types/schemas';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';

/**
 * What a contact record adds to its title (Refs #554): how long it took, how it left the sale
 * and the deal it was about (a link to the deal). Nothing when none of them was given.
 */
export function ContactDetails({ event }: { event: ContactRecordedEvent }) {
  const t = useTranslations('leadFollowUp');
  const locale = useLocale();
  const parts = [
    event.durationMinutes !== null && t('durationMinutes', { minutes: event.durationMinutes }),
    event.outcome && t(`outcomes.${event.outcome}`),
  ].filter((part): part is string => typeof part === 'string');
  if (parts.length === 0 && !event.deal) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-gray-600">
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
      {event.deal && (
        <Link
          href={`/${locale}/deals/${event.deal.id}`}
          className="min-w-0 truncate text-blue-600 hover:underline"
        >
          {t('dealLink', { name: event.deal.name })}
        </Link>
      )}
    </p>
  );
}
