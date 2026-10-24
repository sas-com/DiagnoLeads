'use client';

import { InlineLoadError } from '@/components/common/inline-load-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addBusinessDays } from '@/lib/features/appointment-reviews/deadline';
import { scheduleFollowUpMessage } from '@/lib/features/objection-card/match';
import { trpc } from '@/lib/trpc/client';
import { Copy, ListPlus, Loader2, MessageSquareReply } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, useState } from 'react';
import { toast } from 'sonner';

/** Business days ahead offered for "we will contact you by …" */
const FOLLOW_UP_BUSINESS_DAYS = 3;

interface ObjectionCardProps {
  organizationId: string;
  leadId: string;
}

/**
 * Objections and NG phrases of the sales playbook that fit why the lead's past attempt stopped
 * (Refs #157), and the words for an open schedule ("we will contact you by …") with a takeaway
 * (#85) to keep the promise. Hidden from those who may not read the playbook.
 */
export function ObjectionCard({ organizationId, leadId }: ObjectionCardProps) {
  const t = useTranslations('objectionCard');
  const tReason = useTranslations('leadHearings.options.pastBlocker');
  const format = useFormatter();
  const locale = useLocale();
  const id = useId();
  const utils = trpc.useUtils();
  const query = trpc.objectionCard.get.useQuery(
    { organizationId, leadId },
    { enabled: !!organizationId, retry: false }
  );
  const [date, setDate] = useState<string | null>(null);
  const addTakeaway = trpc.leadFollowUp.createTask.useMutation({
    onSuccess: () => {
      utils.leadFollowUp.tasks.invalidate();
      toast.success(t('takeawayAdded'));
    },
    onError: () => toast.error(t('takeawayError')),
  });

  // Hidden from those who may not read the playbook; a failed request shows an error (#431)
  if (query.error?.data?.code === 'FORBIDDEN') return null;
  const data = query.data;
  const followUpOn = date ?? (data ? addBusinessDays(data.today, FOLLOW_UP_BUSINESS_DAYS) : '');
  const dateLabel = followUpOn
    ? format.dateTime(new Date(`${followUpOn}T00:00:00Z`), {
        month: 'long',
        day: 'numeric',
        weekday: 'short',
        timeZone: 'UTC',
      })
    : '';
  const message = !data
    ? ''
    : data.scheduleTemplate
      ? scheduleFollowUpMessage(data.scheduleTemplate, dateLabel)
      : t('defaultSchedule', { date: dateLabel });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyError'));
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <MessageSquareReply className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
      </div>

      {!data && query.isError ? (
        <InlineLoadError onRetry={() => void query.refetch()} />
      ) : !data ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : (
        <div className="space-y-4">
          {data.signals.length > 0 ? (
            <div className="flex flex-wrap gap-1.5" aria-label={t('signals')}>
              {data.signals.map((signal) => (
                <Badge key={signal.reason} color="amber">
                  {t('signal', {
                    reason: tReason(signal.reason),
                    sources: signal.sources.map((source) => t(`sources.${source}`)).join('・'),
                  })}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('noSignals')}</p>
          )}

          {!data.hasPlaybook ? (
            <p className="text-sm text-muted-foreground">
              {t('noPlaybook')}{' '}
              <Link
                href={`/${locale}/settings/ax-playbook`}
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                {t('openPlaybook')}
              </Link>
            </p>
          ) : (
            <>
              {data.objections.length > 0 && (
                <section aria-labelledby={`${id}-objections`}>
                  <h3 id={`${id}-objections`} className="mb-1 text-xs text-muted-foreground">
                    {t('objections')}
                  </h3>
                  <ul className="space-y-2">
                    {data.objections.map((row, index) => (
                      <li
                        key={`${index}-${row.customer}`}
                        className="rounded-md border p-3 text-sm"
                      >
                        <p className="font-medium text-foreground">「{row.customer}」</p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-foreground">
                          {row.response}
                        </p>
                        {row.note && (
                          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                            {row.note}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t('matched', {
                            reasons: row.matched.map((reason) => tReason(reason)).join('・'),
                          })}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {data.signals.length > 0 && data.objections.length === 0 && (
                <p className="text-xs text-muted-foreground">{t('noObjections')}</p>
              )}
              {data.ngPhrases.length > 0 && (
                <section aria-labelledby={`${id}-ng`}>
                  <h3 id={`${id}-ng`} className="mb-1 text-xs text-muted-foreground">
                    {t('ngPhrases')}
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {data.ngPhrases.map((row, index) => (
                      <li key={`${index}-${row.ng}`} className="break-words">
                        <span className="text-red-700 line-through dark:text-red-400">
                          {row.ng}
                        </span>
                        {' → '}
                        <span className="text-foreground">{row.alternative}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          <section className="space-y-2 border-t pt-3" aria-labelledby={`${id}-schedule`}>
            <h3 id={`${id}-schedule`} className="text-xs text-muted-foreground">
              {t('scheduleTitle')}
            </h3>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor={`${id}-date`} className="text-xs">
                  {t('scheduleDate')}
                </Label>
                <Input
                  id={`${id}-date`}
                  type="date"
                  className="w-44"
                  min={data.today}
                  value={followUpOn}
                  onChange={(event) => setDate(event.target.value || null)}
                />
              </div>
            </div>
            <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm text-foreground">
              {message}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={copy}>
                <Copy className="mr-1 h-4 w-4" aria-hidden="true" />
                {t('copy')}
              </Button>
              {data.canAddTakeaway && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!followUpOn || addTakeaway.isPending}
                  onClick={() =>
                    addTakeaway.mutate({
                      organizationId,
                      leadId,
                      kind: 'takeaway',
                      title: t('takeawayTitle', { date: dateLabel }),
                      dueOn: followUpOn,
                    })
                  }
                >
                  {addTakeaway.isPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <ListPlus className="mr-1 h-4 w-4" aria-hidden="true" />
                  )}
                  {t('addTakeaway')}
                </Button>
              )}
            </div>
          </section>
        </div>
      )}
    </Card>
  );
}
