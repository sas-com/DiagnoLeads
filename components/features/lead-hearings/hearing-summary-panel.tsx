'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent } from '@/components/ui/card';
import { toDiagnosticLocale } from '@/lib/features/lead-hearings/form';
import {
  type HearingSummaryItem,
  type HearingSummaryTodo,
  type HearingSummaryTranslate,
  formatHearingSummaryText,
  hearingSummaryDate,
  hearingSummaryItemText,
  hearingSummaryLeadName,
  hearingSummaryTodos,
} from '@/lib/features/lead-hearings/summary';
import { trpc } from '@/lib/trpc/client';
import { AlertTriangle, ArrowRight, Copy, Loader2, Printer, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { toast } from 'sonner';

const SOURCE_COLORS = { prefilled: 'blue', confirmed: 'emerald', corrected: 'violet' } as const;

/**
 * Put text on the clipboard: the Clipboard API, or (without it, e.g. over plain http) a
 * selected hidden textarea and the copy command. Resolves false when neither worked.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied or unavailable: try the fallback
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

interface HearingSummaryPanelProps {
  organizationId: string;
  hearingId: string;
  /** Go to a field in the record (the editor switches the view and scrolls to it) */
  onJump: (todo: HearingSummaryTodo) => void;
  /** Edits on screen that are not saved yet (they are not in the summary) */
  pendingChanges?: boolean;
}

/** The meeting summary of a hearing (Refs #97): copy, print and what to confirm next time */
export function HearingSummaryPanel({
  organizationId,
  hearingId,
  onJump,
  pendingChanges = false,
}: HearingSummaryPanelProps) {
  const t = useTranslations('leadHearings');
  const tRoot = useTranslations();
  const locale = useLocale();
  const translate: HearingSummaryTranslate = (key, values) => tRoot(key, values);

  const query = trpc.leadHearings.summary.useQuery(
    { organizationId, id: hearingId, locale: toDiagnosticLocale(locale) },
    { enabled: !!organizationId, retry: false }
  );
  const summary = query.data?.summary;
  const todos = useMemo(() => (summary ? hearingSummaryTodos(summary) : []), [summary]);

  if (query.isError) {
    return (
      <Callout title={t('summary.loadError')} icon={AlertTriangle} color="red">
        <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()}>
          <RefreshCw className="h-4 w-4" />
          {t('summary.retry')}
        </Button>
      </Callout>
    );
  }
  if (!summary) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleCopy = async () => {
    const copied = await copyTextToClipboard(formatHearingSummaryText(summary, translate));
    if (copied) toast.success(t('summary.copied'));
    else toast.error(t('summary.copyError'));
  };

  const leadName = hearingSummaryLeadName(summary);
  const date = hearingSummaryDate(summary.heldOn, translate);
  const reasonText = (reasons: readonly string[]) =>
    reasons.map((reason) => t(`summary.reasons.${reason}`)).join(' / ');

  const itemBadges = (item: HearingSummaryItem) => (
    <>
      {item.source && (
        <Badge color={SOURCE_COLORS[item.source]} size="sm">
          {t(`sources.${item.source}`)}
        </Badge>
      )}
      {item.flags.next && (
        <Badge color="amber" size="sm">
          {t('statuses.next')}
        </Badge>
      )}
      {item.flags.changed && (
        <Badge color="violet" size="sm">
          {t('summary.changed')}
        </Badge>
      )}
    </>
  );

  return (
    <div className="space-y-4" data-hearing-summary data-testid="hearing-summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{t('summary.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {leadName ? `${leadName} · ${date}` : date}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" onClick={handleCopy}>
            <Copy className="h-4 w-4" />
            {t('summary.copy')}
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            {t('summary.print')}
          </Button>
        </div>
      </div>

      {pendingChanges && (
        <p className="text-sm text-amber-700 print:hidden">{t('summary.unsavedNote')}</p>
      )}

      {summary.sections.map((section) =>
        section.items.length === 0 ? null : (
          <Card key={section.id} className="break-inside-avoid">
            <CardContent className="pt-4">
              <h3 className="mb-2 border-b pb-2 font-semibold">{section.title}</h3>
              <dl className="divide-y">
                {section.items.map((item) => (
                  <div
                    key={item.key}
                    className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr]"
                    data-testid={`hearing-summary-item-${item.key}`}
                  >
                    <dt className="text-sm text-muted-foreground">{item.label}</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      <span
                        className={
                          item.value === null ? 'text-muted-foreground' : 'whitespace-pre-wrap'
                        }
                      >
                        {hearingSummaryItemText(item, translate)}
                      </span>
                      {itemBadges(item)}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        )
      )}

      <Card className="break-inside-avoid">
        <CardContent className="pt-4">
          <h3 className="mb-1 font-semibold">{t('summary.todoTitle')}</h3>
          {todos.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('summary.none')}</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground print:hidden">
                {t('summary.todoHint')}
              </p>
              <ul className="space-y-1" data-testid="hearing-summary-todos">
                {todos.map((todo) => (
                  <li key={todo.key}>
                    <button
                      type="button"
                      onClick={() => onJump(todo)}
                      className="inline-flex min-h-9 items-center gap-2 rounded-md text-left text-sm text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 print:text-black"
                    >
                      <ArrowRight className="h-4 w-4 shrink-0 print:hidden" aria-hidden="true" />
                      <span className="font-medium">{todo.label}</span>
                      <span className="text-muted-foreground">({reasonText(todo.reasons)})</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="break-inside-avoid">
        <CardContent className="pt-4">
          {summary.previousHeldOn === null ? (
            <p className="text-sm text-muted-foreground">{t('summary.noPrevious')}</p>
          ) : (
            <>
              <h3 className="mb-2 font-semibold">
                {t('summary.changedTitle', {
                  date: hearingSummaryDate(summary.previousHeldOn, translate),
                })}
              </h3>
              {summary.changedSincePrevious.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('summary.noChanges')}</p>
              ) : (
                <table className="w-full text-sm" data-testid="hearing-summary-changes">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1 pr-2 font-normal">
                        <span className="sr-only">{t('summary.item')}</span>
                      </th>
                      <th className="py-1 pr-2 font-normal">{t('summary.before')}</th>
                      <th className="py-1 font-normal">{t('summary.after')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.changedSincePrevious.map((change) => (
                      <tr key={change.key} className="border-b last:border-b-0 align-top">
                        <th scope="row" className="py-1 pr-2 text-left font-medium">
                          {change.label}
                        </th>
                        <td className="py-1 pr-2 text-muted-foreground">
                          {change.before ?? t('summary.empty')}
                        </td>
                        <td className="py-1">{change.after ?? t('summary.empty')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
