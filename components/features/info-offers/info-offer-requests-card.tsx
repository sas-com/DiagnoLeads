'use client';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { trpc } from '@/lib/trpc/client';
import { BookOpen } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId } from 'react';
import { toast } from 'sonner';

/**
 * Documents and seminars the lead requested from the AX diagnosis result (Refs #153), with the
 * seminar attendance. Hidden when there are none.
 */
export function InfoOfferRequestsCard({
  organizationId,
  leadId,
}: {
  organizationId: string;
  leadId: string;
}) {
  const t = useTranslations('infoOffers.lead');
  const format = useFormatter();
  const id = useId();
  const utils = trpc.useUtils();
  const query = trpc.infoOffers.leadRequests.useQuery(
    { organizationId, leadId },
    { enabled: !!organizationId, retry: false }
  );
  const attendance = trpc.infoOffers.setAttendance.useMutation({
    onSuccess: () => {
      utils.infoOffers.leadRequests.invalidate({ organizationId, leadId });
      toast.success(t('saved'));
    },
    onError: () => toast.error(t('saveError')),
  });

  const items = query.data?.items ?? [];
  if (query.isError || items.length === 0) return null;
  const day = (value: Date | string) =>
    format.dateTime(new Date(typeof value === 'string' ? `${value}T00:00:00Z` : value), {
      dateStyle: 'medium',
      timeZone: typeof value === 'string' ? 'UTC' : 'Asia/Tokyo',
    });

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
      </div>
      <ul className="space-y-2">
        {items.map((item) => {
          const checkboxId = `${id}-${item.id}`;
          return (
            <li key={item.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={item.kind === 'seminar' ? 'violet' : 'blue'}>{t(item.kind)}</Badge>
                <span className="font-medium text-foreground">{item.title}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('requestedAt', { date: day(item.createdAt) })}
                {item.scheduledOn && ` ・ ${t('scheduledOn', { date: day(item.scheduledOn) })}`}
              </p>
              {!item.identityVerified && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('unverified')}</p>
              )}
              {item.kind === 'seminar' && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Checkbox
                    id={checkboxId}
                    checked={item.attendedAt !== null}
                    disabled={!query.data?.canRecordAttendance || attendance.isPending}
                    onCheckedChange={(value) =>
                      attendance.mutate({ organizationId, id: item.id, attended: value === true })
                    }
                  />
                  <Label htmlFor={checkboxId} className="font-normal">
                    {t('attended')}
                  </Label>
                  {item.attendanceRecordedByName && (
                    <span className="text-xs text-muted-foreground">
                      {t('attendedBy', { name: item.attendanceRecordedByName })}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
