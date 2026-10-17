'use client';

import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { isRestricted } from '@/lib/features/lead-hearings/ai-policy';
import { toDiagnosticLocale } from '@/lib/features/lead-hearings/form';
import { hearingSummaryTodos } from '@/lib/features/lead-hearings/summary';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowRight, ClipboardList, FileText, Loader2 } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo } from 'react';

const DEAL_RATING_COLORS = { a: 'emerald', b: 'blue', c: 'gray' } as const;
const MAX_TODOS = 5;

interface LeadHearingOverviewProps {
  organizationId: string;
  leadId: string;
  /** Smaller, without a card around it (the list's side panel) */
  compact?: boolean;
}

/**
 * What to do next with the lead (Refs #97, #108): the latest hearing and the items to confirm
 * at the next meeting, from the meeting summary. The full summary is one click away.
 */
export function LeadHearingOverview({
  organizationId,
  leadId,
  compact = false,
}: LeadHearingOverviewProps) {
  const t = useTranslations('leadDetail.hearing');
  const tHearings = useTranslations('leadHearings');
  const format = useFormatter();
  const locale = useLocale();

  const list = trpc.leadHearings.listByLead.useQuery(
    { organizationId, leadId },
    { enabled: !!organizationId }
  );
  const latest = list.data?.items[0];
  const summary = trpc.leadHearings.summary.useQuery(
    { organizationId, id: latest?.id ?? '', locale: toDiagnosticLocale(locale) },
    { enabled: !!organizationId && !!latest, retry: false }
  );
  const todos = useMemo(
    () => (summary.data ? hearingSummaryTodos(summary.data.summary) : []),
    [summary.data]
  );

  const href = latest ? `/${locale}/leads/${leadId}/hearings/${latest.id}` : '';
  const heldOn = latest
    ? format.dateTime(new Date(`${latest.heldOn}T00:00:00Z`), {
        dateStyle: 'medium',
        timeZone: 'UTC',
      })
    : '';

  const body = list.isError ? (
    <p className="text-sm text-red-600 dark:text-red-400">{t('loadError')}</p>
  ) : list.isLoading ? (
    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
  ) : !latest ? (
    <p className="text-sm text-muted-foreground">{t('none')}</p>
  ) : (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{t('latest', { date: heldOn })}</span>
        {latest.dealRating && (
          <Badge
            color={
              DEAL_RATING_COLORS[latest.dealRating as keyof typeof DEAL_RATING_COLORS] ?? 'gray'
            }
          >
            {tHearings('card.dealRating', {
              rating: tHearings(`options.dealRating.${latest.dealRating}`),
            })}
          </Badge>
        )}
        {latest.missingCount > 0 && (
          <Badge color="amber">{tHearings('card.missing', { count: latest.missingCount })}</Badge>
        )}
      </div>

      {latest.aiSourceAnalysis && isRestricted(latest.aiSourceAnalysis) && (
        <Callout
          title={t('aiRestricted', {
            value: tHearings(`options.aiSourceAnalysis.${latest.aiSourceAnalysis.value}`),
          })}
          icon={AlertTriangle}
          color="yellow"
        >
          <p>{t('aiRestrictedHelp')}</p>
          {latest.aiSourceAnalysis.conditions && (
            <p className="mt-1 break-words">
              {t('aiConditions', { conditions: latest.aiSourceAnalysis.conditions })}
            </p>
          )}
        </Callout>
      )}

      <div>
        <h3 className="mb-1 text-xs text-muted-foreground">{t('nextSteps')}</h3>
        {summary.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : todos.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noNextSteps')}</p>
        ) : (
          <ul className="space-y-1" data-testid="lead-next-steps">
            {todos.slice(0, compact ? 3 : MAX_TODOS).map((todo) => (
              <li key={todo.key} className="flex items-start gap-2 text-sm text-foreground">
                <ArrowRight
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="break-words">{todo.label}</span>
              </li>
            ))}
            {todos.length > (compact ? 3 : MAX_TODOS) && (
              <li className="pl-6 text-sm text-muted-foreground">
                {t('more', { count: todos.length - (compact ? 3 : MAX_TODOS) })}
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Link
          href={`${href}?view=summary`}
          className="inline-flex min-h-9 items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          <FileText className="h-4 w-4" aria-hidden="true" />
          {t('openSummary')}
        </Link>
        <Link
          href={href}
          className="inline-flex min-h-9 items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          <ClipboardList className="h-4 w-4" aria-hidden="true" />
          {t('openHearing')}
        </Link>
      </div>
    </div>
  );

  const heading = (
    <h2
      id={`lead-hearing-overview-${compact ? 'compact' : 'full'}`}
      className={cn(
        'flex items-center gap-2 font-semibold text-foreground',
        compact ? 'mb-2 text-sm' : 'mb-3 text-base'
      )}
    >
      <ClipboardList
        className={cn('text-muted-foreground', compact ? 'h-4 w-4' : 'h-5 w-5')}
        aria-hidden="true"
      />
      {t('title')}
    </h2>
  );

  if (compact) {
    return (
      <section aria-labelledby="lead-hearing-overview-compact">
        {heading}
        {body}
      </section>
    );
  }
  return (
    <section aria-labelledby="lead-hearing-overview-full">
      <Card className="p-5">
        {heading}
        {body}
      </Card>
    </section>
  );
}
