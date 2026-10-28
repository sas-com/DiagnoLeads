'use client';

import { PageHeader } from '@/components/common/page-header';
import { TAP_TARGET } from '@/components/common/tap-target';
import { DealActivitiesCard } from '@/components/features/lead-activity/deal-activities-card';
import { LeadNextActionsCard } from '@/components/features/lead-follow-up/lead-next-actions-card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useOrganization } from '@/hooks/use-organization';
import type { DealDetail, DealHistoryView } from '@/lib/features/deals/service';
import {
  DEAL_STAGES,
  type DealStage,
  forecastCategory,
  isOpenStage,
} from '@/lib/features/deals/types/pipeline';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { ChevronLeft, Loader2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DealFormDialog } from './deal-form-dialog';
import { dealMarks, formatDealDate, formatYen } from './deal-format';
import { DealMarks } from './deal-marks';
import { DealStageBadge } from './deal-stage-badge';
import { DealsForbidden } from './deals-forbidden';
import { useDealMutations } from './use-deal-mutations';
import { useStageMove } from './use-stage-move';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The heading of the page's cards, all alike (#720) */
const CARD_TITLE = 'text-base font-bold text-gray-900 dark:text-gray-50';

function dateTime(value: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

/**
 * Gives the focus back to the control that opened a dialog. The edit and delete dialogs are
 * opened from the ⋯ menu or a card's button, not from a dialog trigger, so Radix has nowhere to
 * return the focus to and would leave it on the page (#720)
 */
function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    remember: (element: HTMLElement | null) => {
      opener.current = element;
    },
    onCloseAutoFocus: (event: Event) => {
      if (!opener.current?.isConnected) return;
      event.preventDefault();
      opener.current.focus();
    },
  };
}

/** One deal (Refs #436): where it stands on the stage path, its values and its history */
export function DealDetailView({ dealId }: { dealId: string }) {
  const t = useTranslations('deals');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { organizationId: contextOrgId } = useOrganization();
  const organizationId = contextOrgId && UUID.test(contextOrgId) ? contextOrgId : '';
  const query = trpc.deals.get.useQuery(
    { organizationId, dealId },
    { enabled: !!organizationId, retry: false }
  );
  // The delete question says a failure itself and stays open for another try (#720)
  const { remove } = useDealMutations({ toastErrors: false });
  const stageMove = useStageMove(organizationId);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  // Deleted, on the way to the deals: the deal read again is not found, which is not news
  const [leaving, setLeaving] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const focus = useReturnFocus();

  const back = { href: `/${locale}/deals`, label: t('detail.back') };
  // The same link as the one PageHeader shows once the deal is read
  const backLink = (
    <Link
      href={back.href}
      className="inline-flex min-h-11 items-center gap-1 rounded-md text-sm text-muted-foreground hover:text-foreground sm:min-h-9"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      {back.label}
    </Link>
  );

  if (!leaving && query.error?.data?.code === 'FORBIDDEN') {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        {backLink}
        <DealsForbidden />
      </div>
    );
  }
  if (!leaving && query.isError) {
    const missing = query.error.data?.code === 'NOT_FOUND';
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        {backLink}
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {missing ? t('detail.notFound') : t('state.loadError')}
        </p>
        {!missing && (
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            {t('state.retry')}
          </Button>
        )}
      </div>
    );
  }
  const deal = query.data;
  if (!deal) {
    return (
      <div className="mx-auto max-w-5xl space-y-4" aria-busy="true">
        {backLink}
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" aria-hidden="true" />
        <span className="sr-only">{tCommon('loading')}</span>
      </div>
    );
  }

  const leadName = deal.lead.company || deal.lead.name;
  const leadLabel = leadName || t('fields.lead');
  const moveTo = (stage: DealStage) =>
    stageMove.move(
      {
        ...deal,
        leadLabel: deal.lead.company || deal.lead.name || '',
        leadSqlDecision: deal.lead.sqlDecision,
      },
      stage
    );

  const deleting = remove.isPending || leaving;
  const confirmDelete = () => {
    setDeleteFailed(false);
    remove.mutate(
      { organizationId, dealId: deal.id },
      {
        onSuccess: () => {
          // The question stays, saying it is deleting, until the deals are shown; replace, so
          // going back does not open the deleted deal
          setLeaving(true);
          router.replace(back.href);
        },
        onError: () => setDeleteFailed(true),
      }
    );
  };
  const openEdit = (opener: HTMLElement | null) => {
    focus.remember(opener);
    setEditOpen(true);
  };

  const hasLinkedDeals = !!deal.previousDeal || deal.nextDeals.length > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <PageHeader
          back={back}
          title={deal.name}
          description={
            <Link
              href={`/${locale}/leads/${deal.lead.id}`}
              className={cn('inline-flex items-center underline underline-offset-2', TAP_TARGET)}
            >
              {[deal.lead.company, deal.lead.name].filter(Boolean).join(' ') || t('fields.lead')}
            </Link>
          }
          meta={
            <>
              <DealStageBadge stage={deal.stage} />
              {!deal.canEdit && (
                <Badge color="gray" className="text-sm">
                  {t('state.readOnly')}
                </Badge>
              )}
            </>
          }
          actions={
            (deal.canEdit || deal.canDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    ref={moreRef}
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 md:h-10 md:w-10"
                    aria-label={t('detail.moreActions')}
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {deal.canEdit && (
                    <DropdownMenuItem
                      className="min-h-11 md:min-h-8"
                      onSelect={() => openEdit(moreRef.current)}
                    >
                      <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                      {tCommon('edit')}
                    </DropdownMenuItem>
                  )}
                  {deal.canEdit && deal.canDelete && <DropdownMenuSeparator />}
                  {deal.canDelete && (
                    <DropdownMenuItem
                      onSelect={() => {
                        focus.remember(moreRef.current);
                        setDeleteFailed(false);
                        setDeleteOpen(true);
                      }}
                      className="min-h-11 text-red-700 focus:bg-red-50 focus:text-red-700 md:min-h-8 dark:text-red-400 dark:focus:bg-red-950 dark:focus:text-red-400"
                    >
                      <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                      {tCommon('delete')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )
          }
        />
        {/* Why there is nothing to change here, for those who came straight from a lead */}
        {!deal.canEdit && (
          <p className="text-sm text-gray-600 dark:text-gray-300">{t('state.readOnlyHint')}</p>
        )}
      </div>

      <StagePath stage={deal.stage} canEdit={deal.canEdit} onMove={moveTo} />

      <div className={cn('grid gap-6', hasLinkedDeals && 'md:grid-cols-[minmax(0,1fr)_18rem]')}>
        <div className="min-w-0 space-y-6">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className={CARD_TITLE}>{t('detail.factsTitle')}</h2>
              {deal.canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={TAP_TARGET}
                  onClick={(event) => openEdit(event.currentTarget)}
                >
                  <Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {tCommon('edit')}
                </Button>
              )}
            </div>
            <DealFacts deal={deal} />
          </Card>
          {/* The lead's next actions: what to do next for the deal (#720, #853) */}
          <LeadNextActionsCard
            organizationId={organizationId}
            leadId={deal.lead.id}
            description={
              leadName
                ? t('detail.leadNextActions', { lead: leadName })
                : t('detail.leadNextActionsNoName')
            }
          />
        </div>
        {hasLinkedDeals && (
          <aside className="space-y-4">
            {deal.previousDeal && (
              <Card className="p-4">
                <h2 className={CARD_TITLE}>{t('detail.previousDeal')}</h2>
                <LinkedDealItem deal={deal.previousDeal} />
              </Card>
            )}
            {deal.nextDeals.length > 0 && (
              <Card className="p-4">
                <h2 className={CARD_TITLE}>{t('detail.nextDeals')}</h2>
                <ul>
                  {deal.nextDeals.map((next) => (
                    <li key={next.id}>
                      <LinkedDealItem deal={next} />
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </aside>
        )}
      </div>

      <DealActivitiesCard
        organizationId={organizationId}
        dealId={deal.id}
        leadId={deal.lead.id}
        leadLabel={leadLabel}
      />

      <Card className="p-5">
        <h2 className={CARD_TITLE}>{t('detail.history')}</h2>
        {deal.history.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {t('detail.historyEmpty')}
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
            {deal.history.map((row, index) => (
              // The rows come newest first: the next one holds the values before this change
              <HistoryRow key={row.id} row={row} before={deal.history[index + 1]} />
            ))}
          </ol>
        )}
      </Card>

      <DealFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        organizationId={organizationId}
        deal={deal}
        onSaved={() => toast.success(t('toasts.saved'))}
        onCloseAutoFocus={focus.onCloseAutoFocus}
      />
      {stageMove.dialogs}
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          // Open until the deletion is done: the page leaves when it succeeds
          if (!deleting) setDeleteOpen(open);
        }}
      >
        <AlertDialogContent onCloseAutoFocus={focus.onCloseAutoFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('detail.deleteDescription', { name: deal.name, lead: leadLabel })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteFailed && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {t('toasts.deleteError')}
            </p>
          )}
          {/* The button's new name alone may not be read out */}
          <output className="sr-only">{deleting ? t('detail.deleting') : ''}</output>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="min-h-11 md:min-h-10">
              {tCommon('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              // aria-disabled, not disabled: the focus stays on the button while it deletes
              aria-disabled={deleting}
              className="min-h-11 bg-red-700 text-white hover:bg-red-800 md:min-h-10 dark:bg-red-700 dark:hover:bg-red-800"
              onClick={(event) => {
                // Stays open, saying it is deleting, until the deletion is done
                event.preventDefault();
                if (!deleting) confirmDelete();
              }}
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                  {t('detail.deleting')}
                </>
              ) : (
                tCommon('delete')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The deal's values (Refs #720): by when first, then the money and who. A closed deal shows the
 * day it was won or lost and why, instead of the forecast. What to do next is the lead's next
 * actions, the card under this one (the owner's decision of 2026-10-28, Epic #856): a next step
 * written before #853, which stopped taking it, is shown last as an earlier note, in lighter text
 * than the deal's values. Long texts take the whole width and keep their line breaks.
 */
function DealFacts({ deal }: { deal: DealDetail }) {
  const t = useTranslations('deals');
  const locale = useLocale();
  const open = isOpenStage(deal.stage);
  const facts: { label: string; value: ReactNode; wide?: boolean; note?: boolean }[] = [];
  const add = (label: string, value: ReactNode, wide = false) => facts.push({ label, value, wide });
  const amount = formatYen(deal.amount, locale) ?? t('card.noAmount');
  const owner = deal.ownerName ?? t('card.unassigned');
  const kind = t(`kinds.${deal.kind}`);

  if (open) {
    // The lead's next actions are on this page, so only the passed close date is marked here
    const { overdue } = dealMarks({ ...deal, hasOpenTask: true }, jstDate());
    add(
      t('fields.expectedCloseOn'),
      deal.expectedCloseOn ? (
        <>
          {formatDealDate(deal.expectedCloseOn)}
          <DealMarks flags={{ overdue, noNextAction: false }} className="mt-0.5 font-normal" />
        </>
      ) : (
        t('card.noCloseDate')
      )
    );
    add(t('fields.amount'), amount);
    add(t('fields.probability'), `${deal.probability}%`);
    add(t('fields.owner'), owner);
    add(t('fields.kind'), kind);
    // No amount yet, no weighted amount either (it counts as 0 in the totals)
    add(
      t('fields.weightedAmount'),
      deal.amount === null ? '—' : formatYen(deal.weightedAmount, locale)
    );
    const category = t(`forecast.${deal.forecastCategory}`);
    // Said whether it follows the probability or was set by hand
    add(
      t('fields.forecastCategory'),
      deal.forecastOverride ? category : t('forecast.auto', { category })
    );
  } else {
    const won = deal.stage === 'won';
    add(
      won ? t('fields.wonOn') : t('fields.lostOn'),
      deal.closedOn ? formatDealDate(deal.closedOn) : '—'
    );
    add(t('fields.amount'), amount);
    add(t('fields.owner'), owner);
    add(t('fields.kind'), kind);
    if (!won) {
      add(
        t('fields.lostReason'),
        deal.lostReason ? <LostReasonLabel reason={deal.lostReason} /> : '—'
      );
      add(t('fields.lostNote'), deal.lostNote ?? '—', true);
    }
  }
  if (deal.competitor) add(t('fields.competitor'), deal.competitor);
  if (deal.nextStep) {
    facts.push({ label: t('detail.legacyNextStep'), value: deal.nextStep, wide: true, note: true });
  }

  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {facts.map((fact) => (
        <div key={fact.label} className={cn(fact.wide && 'sm:col-span-2')}>
          <dt className="text-sm text-gray-600 dark:text-gray-300">{fact.label}</dt>
          <dd
            className={cn(
              'break-words',
              fact.note
                ? 'font-normal text-gray-700 dark:text-gray-300'
                : 'font-medium text-gray-900 dark:text-gray-50',
              fact.wide && 'whitespace-pre-line'
            )}
          >
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function LostReasonLabel({ reason }: { reason: string }) {
  const t = useTranslations('pipeline.lostReason');
  return <>{t(reason)}</>;
}

/** The stages in order; the current one is marked, the others move the deal there */
function StagePath({
  stage,
  canEdit,
  onMove,
}: {
  stage: DealStage;
  canEdit: boolean;
  onMove: (stage: DealStage) => void;
}) {
  const t = useTranslations('deals');
  const currentIndex = DEAL_STAGES.indexOf(stage);
  return (
    // A group of steps and buttons, not a navigation: nothing here leaves the page (#720)
    <fieldset className="min-w-0">
      <legend className="sr-only">{t('detail.stagePath')}</legend>
      <ol className="flex flex-wrap gap-2">
        {DEAL_STAGES.map((step, index) => {
          const current = step === stage;
          const passed = isOpenStage(stage) && index < currentIndex;
          const classes = cn(
            'inline-flex min-h-11 items-center rounded-md border px-3 text-sm',
            current
              ? 'border-gray-900 bg-gray-900 font-bold text-white dark:border-gray-50 dark:bg-gray-50 dark:text-gray-900'
              : passed
                ? 'border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'
                : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'
          );
          return (
            <li key={step}>
              {current || !canEdit ? (
                <span className={classes} aria-current={current ? 'step' : undefined}>
                  {t(`stages.${step}`)}
                </span>
              ) : (
                <button
                  type="button"
                  className={cn(classes, 'hover:bg-gray-50 dark:hover:bg-gray-800')}
                  aria-label={t('detail.moveTo', { stage: t(`stages.${step}`) })}
                  onClick={() => onMove(step)}
                >
                  {t(`stages.${step}`)}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </fieldset>
  );
}

function LinkedDealItem({ deal }: { deal: { id: string; name: string; stage: DealStage } }) {
  const locale = useLocale();
  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      {/* 44px on phones by its padding, so the name can still be cut with an ellipsis */}
      <Link
        href={`/${locale}/deals/${deal.id}`}
        className="block min-w-0 truncate py-3 text-sm underline underline-offset-2 md:py-0"
      >
        {deal.name}
      </Link>
      <DealStageBadge stage={deal.stage} />
    </div>
  );
}

type HistoryField = Exclude<
  keyof DealHistoryView,
  'id' | 'changedFields' | 'changedByName' | 'changedAt' | 'ownerName'
>;
/** In the order of the deal's values on this page */
const HISTORY_FIELDS: readonly HistoryField[] = [
  'stage',
  'expectedCloseOn',
  'amount',
  'probability',
  'ownerUserId',
  'kind',
  'forecastOverride',
];
const isHistoryField = (field: string): field is HistoryField =>
  (HISTORY_FIELDS as readonly string[]).includes(field);

/**
 * One change of the deal (Refs #720): what changed, from what to what ("確度：40% → 70%"). The
 * row holds the values after the change; `before` is the row before it. The oldest row shown
 * may have none (the history is cut), and then only the new value is shown. A deal's first row
 * names its values.
 */
function HistoryRow({ row, before }: { row: DealHistoryView; before?: DealHistoryView }) {
  const t = useTranslations('deals');
  const locale = useLocale();
  const created = row.changedFields.includes('created');

  const textOf = (field: HistoryField, values: DealHistoryView): string => {
    switch (field) {
      case 'stage':
        return t(`stages.${values.stage}`);
      case 'probability':
        return `${values.probability}%`;
      case 'amount':
        return formatYen(values.amount, locale) ?? t('card.noAmount');
      case 'expectedCloseOn':
        return values.expectedCloseOn
          ? formatDealDate(values.expectedCloseOn)
          : t('card.noCloseDate');
      case 'forecastOverride':
        // "Auto (best case)", never "from the probability", which would read like a range
        return values.forecastOverride
          ? t(`forecast.${values.forecastOverride}`)
          : t('detail.historyForecastAuto', {
              category: t(`forecast.${forecastCategory(values)}`),
            });
      case 'ownerUserId':
        return values.ownerName ?? t('card.unassigned');
      case 'kind':
        return t(`kinds.${values.kind}`);
    }
  };
  const label = (field: HistoryField) => t(`historyFields.${field}`);
  const valueLine = (field: HistoryField) =>
    t('detail.historyValue', { field: label(field), after: textOf(field, row) });

  const lines: { key: string; text: ReactNode }[] = created
    ? (['stage', 'expectedCloseOn', 'amount', 'probability', 'ownerUserId'] as const).map(
        (field) => ({ key: field, text: valueLine(field) })
      )
    : HISTORY_FIELDS.filter((field) => row.changedFields.includes(field)).map((field) => ({
        key: field,
        text: before
          ? t.rich('detail.historyDiff', {
              field: label(field),
              before: textOf(field, before),
              after: textOf(field, row),
              arrow: (chunks) => (
                <>
                  <span aria-hidden="true">{chunks}</span>
                  <span className="sr-only">{t('detail.historyArrowSpoken')}</span>
                </>
              ),
            })
          : valueLine(field),
      }));
  // Fields this screen does not know (written by a newer version)
  if (
    !created &&
    row.changedFields.some((field) => field !== 'created' && !isHistoryField(field))
  ) {
    lines.push({ key: 'other', text: t('detail.historyOther') });
  }

  return (
    <li className="py-2.5 text-sm">
      <p className="text-gray-600 dark:text-gray-300">
        <time dateTime={row.changedAt.toISOString()}>{dateTime(row.changedAt, locale)}</time>
        {row.changedByName && ` · ${row.changedByName}`}
      </p>
      {created && (
        <p className="font-medium text-gray-900 dark:text-gray-50">{t('detail.historyCreated')}</p>
      )}
      <ul className="text-gray-900 dark:text-gray-50">
        {lines.map((line) => (
          <li key={line.key}>{line.text}</li>
        ))}
      </ul>
    </li>
  );
}
