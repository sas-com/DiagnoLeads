'use client';

import { EventTitle } from '@/components/features/lead-activity/lead-activity-card';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc/client';
import { History, Loader2 } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import Link from 'next/link';

interface LeadRecentActivityProps {
  organizationId: string;
  leadId: string;
  limit?: number;
  /** "すべての活動を見る": a link ... */
  allHref?: string;
  /** ... or an action (e.g. switch to the activity tab) */
  onShowAll?: () => void;
}

/** The newest few events of a lead (Refs #108); the full timeline is the activity tab */
export function LeadRecentActivity({
  organizationId,
  leadId,
  limit = 3,
  allHref,
  onShowAll,
}: LeadRecentActivityProps) {
  const t = useTranslations('leadDetail.activity');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const query = trpc.leadActivity.list.useQuery(
    { organizationId, leadId, limit },
    { enabled: !!organizationId }
  );
  const items = query.data?.items ?? [];

  return (
    <section aria-labelledby="lead-recent-activity" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2
          id="lead-recent-activity"
          className="flex items-center gap-2 text-sm font-semibold text-foreground"
        >
          <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t('recent')}
        </h2>
        {allHref ? (
          <Link href={allHref} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            {t('showAll')}
          </Link>
        ) : onShowAll ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 text-blue-600 dark:text-blue-400"
            onClick={onShowAll}
          >
            {t('showAll')}
          </Button>
        ) : null}
      </div>
      {query.isError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{t('loadError')}</p>
      ) : query.isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ol className="space-y-2">
          {items.map((event) => {
            const at = new Date(event.at);
            return (
              <li key={event.id} className="min-w-0 text-sm">
                <p className="break-words text-foreground">
                  <EventTitle event={event} />
                </p>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={at.toISOString()}>{format.relativeTime(at, now)}</time>
                  {event.actor && ` · ${event.actor.deleted ? t('deletedUser') : event.actor.name}`}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
