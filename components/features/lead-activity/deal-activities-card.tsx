'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { RecordActivityDialog } from '@/components/features/lead-follow-up/record-activity-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { Loader2, NotebookPen } from 'lucide-react';
import { useLocale, useNow, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { ActivityItem } from './lead-activity-card';

interface DealActivitiesCardProps {
  organizationId: string;
  dealId: string;
  leadId: string;
  /** The lead's company or name, in the recording dialog */
  leadLabel: string;
}

/**
 * The contact records of a deal on its page (Refs #554), newest first, and recording one for it
 * (the deal already chosen). Shown to those who may read deals (the deal page itself checks).
 */
export function DealActivitiesCard({
  organizationId,
  dealId,
  leadId,
  leadLabel,
}: DealActivitiesCardProps) {
  const t = useTranslations('leadActivity.dealActivities');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const now = useNow({ updateInterval: 60_000 });
  const [recordOpen, setRecordOpen] = useState(false);
  const query = trpc.leadActivity.forDeal.useQuery(
    { organizationId, dealId },
    { enabled: !!organizationId }
  );
  const data = query.data;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-bold text-gray-900 dark:text-gray-50">{t('title')}</h2>
        {data && data.total > 0 && <Badge color="gray">{data.total}</Badge>}
        {data?.canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn('ml-auto', TAP_TARGET)}
            onClick={() => setRecordOpen(true)}
          >
            <NotebookPen className="mr-1 h-4 w-4" aria-hidden="true" />
            {t('record')}
          </Button>
        )}
      </div>

      {query.isError ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p className="text-red-600 dark:text-red-400">{t('loadError')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()}>
            {tCommon('retry')}
          </Button>
        </div>
      ) : !data ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('loading')}
        </p>
      ) : data.items.length === 0 ? (
        <p className="text-sm text-gray-500">{data.canEdit ? t('emptyCanEdit') : t('empty')}</p>
      ) : (
        <>
          <ol className="space-y-4">
            {data.items.map((event) => (
              <ActivityItem key={event.id} event={event} leadId={leadId} now={now} />
            ))}
          </ol>
          {data.total > data.items.length && (
            <p className="mt-3 text-sm text-gray-500">
              {t('more', { shown: data.items.length, total: data.total })}{' '}
              <Link
                href={`/${locale}/leads/${leadId}?tab=activity`}
                className="text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400"
              >
                {t('seeAll')}
              </Link>
            </p>
          )}
        </>
      )}

      {data?.canEdit && (
        <RecordActivityDialog
          open={recordOpen}
          onOpenChange={setRecordOpen}
          organizationId={organizationId}
          leadId={leadId}
          leadLabel={leadLabel}
          defaultDealId={dealId}
        />
      )}
    </Card>
  );
}
