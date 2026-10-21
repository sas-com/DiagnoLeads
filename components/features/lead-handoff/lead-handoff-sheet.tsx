'use client';

import { useTaskTitle } from '@/components/features/lead-follow-up/task-parts';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent } from '@/components/ui/card';
import { useOrganization } from '@/hooks/use-organization';
import { toDiagnosticLocale } from '@/lib/features/lead-hearings/form';
import {
  type HearingSummaryTranslate,
  hearingSummaryDate,
  hearingSummaryItemText,
  hearingSummaryTodos,
  splitHearingSummaryItems,
} from '@/lib/features/lead-hearings/summary';
import { trpc } from '@/lib/trpc/client';
import { AlertTriangle, ArrowLeft, Loader2, Printer } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo } from 'react';

/**
 * Handoff sheet of the first meeting (Refs #86): what sales heard, on one printable page for
 * the technical team. Read live from the latest hearing summary (#97) and the open takeaways
 * (#85); the items left unconfirmed or for next time are listed so they are asked, not assumed.
 */
export function LeadHandoffSheet({ leadId }: { leadId: string }) {
  const t = useTranslations('leadHandoff');
  const tSummary = useTranslations('leadHearings.summary');
  const tPhase = useTranslations('pipeline.dealPhase');
  const tRoot = useTranslations();
  const locale = useLocale();
  const taskTitle = useTaskTitle();
  const translate: HearingSummaryTranslate = (key, values) => tRoot(key, values);
  const { organizationId } = useOrganization();
  const enabled = !!organizationId;

  const header = trpc.leadHandoff.get.useQuery(
    { organizationId: organizationId ?? '', leadId },
    { enabled, retry: false }
  );
  const hearingId = header.data?.latestHearing?.id;
  const summary = trpc.leadHearings.summary.useQuery(
    {
      organizationId: organizationId ?? '',
      id: hearingId ?? '',
      locale: toDiagnosticLocale(locale),
    },
    { enabled: enabled && !!hearingId, retry: false }
  );
  const tasks = trpc.leadFollowUp.tasks.useQuery(
    { organizationId: organizationId ?? '', leadId },
    { enabled, retry: false }
  );
  const todos = useMemo(
    () => (summary.data ? hearingSummaryTodos(summary.data.summary) : []),
    [summary.data]
  );
  const takeaways = (tasks.data?.items ?? []).filter(
    (task) => task.kind === 'takeaway' && !task.done
  );

  if (header.isError || summary.isError) {
    return <Callout title={t('loadError')} icon={AlertTriangle} color="red" />;
  }
  const data = header.data;
  if (!data || (hearingId && !summary.data)) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  const { lead } = data;
  const leadName = [lead.company, lead.name].filter(Boolean).join(' ') || t('noName');
  const date = (value: string) => hearingSummaryDate(value, translate);
  const reasonText = (reasons: readonly string[]) =>
    reasons.map((reason) => tSummary(`reasons.${reason}`)).join(' / ');

  return (
    <div className="space-y-4" data-lead-handoff data-testid="lead-handoff">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          href={`/${locale}/leads/${leadId}`}
          className="inline-flex min-h-9 items-center gap-1 text-sm text-blue-700 hover:underline dark:text-blue-400"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('backToLead')}
        </Link>
        <Button type="button" variant="outline" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden="true" />
          {t('print')}
        </Button>
      </div>

      <div>
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{leadName}</p>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t('dealPhase')}</dt>
          <dd>{lead.dealPhase ? tPhase(lead.dealPhase) : t('unset')}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t('handedOffOn')}</dt>
          <dd>{lead.handedOffOn ? date(lead.handedOffOn) : t('notYet')}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t('assignee')}</dt>
          <dd>{lead.assigneeName ?? t('unset')}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t('hearingOn')}</dt>
          <dd>{data.latestHearing ? date(data.latestHearing.heldOn) : t('noHearing')}</dd>
        </div>
      </dl>
      {!lead.handedOffOn && (
        <p className="text-sm text-amber-700 dark:text-amber-400 print:hidden">{t('notYetNote')}</p>
      )}

      {summary.data ? (
        summary.data.summary.sections.map((section) => {
          if (section.items.length === 0) return null;
          const { filled, empty } = splitHearingSummaryItems(section.items);
          return (
            <Card key={section.id} className="break-inside-avoid">
              <CardContent className="pt-4">
                <h2 className="mb-2 border-b pb-2 font-semibold">{section.title}</h2>
                <dl className="divide-y">
                  {filled.map((item) => (
                    <div key={item.key} className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr]">
                      <dt className="text-sm text-muted-foreground">{item.label}</dt>
                      <dd className="whitespace-pre-wrap text-sm">
                        {hearingSummaryItemText(item, translate)}
                        {item.flags.next && item.value !== null && (
                          <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
                            （{tSummary('reasons.next')}）
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
                {empty.length > 0 && (
                  <p className="border-t pt-2 text-sm text-muted-foreground">
                    {tSummary('emptyItems', {
                      count: empty.length,
                      items: empty.map((item) => item.label).join(tSummary('listSeparator')),
                    })}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })
      ) : (
        <p className="text-sm text-muted-foreground">{t('noHearingNote')}</p>
      )}

      <Card className="break-inside-avoid">
        <CardContent className="pt-4">
          <h2 className="mb-1 font-semibold">{t('todoTitle')}</h2>
          {todos.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tSummary('none')}</p>
          ) : (
            <ul className="space-y-1 text-sm" data-testid="lead-handoff-todos">
              {todos.map((todo) => (
                <li key={todo.key}>
                  <span className="font-medium">{todo.label}</span>
                  <span className="ml-1 text-muted-foreground">({reasonText(todo.reasons)})</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="break-inside-avoid">
        <CardContent className="pt-4">
          <h2 className="mb-1 font-semibold">{t('takeawaysTitle')}</h2>
          {takeaways.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tSummary('none')}</p>
          ) : (
            <ul className="space-y-1 text-sm" data-testid="lead-handoff-takeaways">
              {takeaways.map((task) => (
                <li key={task.id}>
                  <span className="font-medium">{taskTitle(task)}</span>
                  <span className="ml-1 text-muted-foreground">
                    {t('due', { date: date(task.dueOn) })}
                    {(task.checkWithUser?.name ?? task.checkWith) &&
                      ` · ${t('checkWith', { name: task.checkWithUser?.name ?? task.checkWith ?? '' })}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
