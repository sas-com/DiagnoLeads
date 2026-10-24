'use client';

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
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useOrganization } from '@/hooks/use-organization';
import type { DealHistoryView } from '@/lib/features/deals/service';
import { DEAL_STAGES, type DealStage, isOpenStage } from '@/lib/features/deals/types/pipeline';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { DealFormDialog } from './deal-form-dialog';
import { formatYen } from './deal-format';
import { DealStageBadge } from './deal-stage-badge';
import { LostReasonDialog } from './lost-reason-dialog';
import { useDealMutations } from './use-deal-mutations';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dateTime(value: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
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
  const { update, remove } = useDealMutations();
  const [editOpen, setEditOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const back = (
    <Link
      href={`/${locale}/deals`}
      className="inline-flex min-h-11 items-center gap-1 text-sm text-gray-600 underline-offset-2 hover:underline dark:text-gray-300"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {t('detail.back')}
    </Link>
  );

  if (query.isError) {
    const missing = query.error.data?.code === 'NOT_FOUND';
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        {back}
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
        {back}
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" aria-hidden="true" />
        <span className="sr-only">{tCommon('loading')}</span>
      </div>
    );
  }

  const moveTo = (stage: DealStage) => {
    if (stage === 'lost') {
      setLostOpen(true);
      return;
    }
    update.mutate(
      { organizationId, dealId: deal.id, stage },
      {
        onSuccess: () =>
          toast.success(t('toasts.moved', { name: deal.name, stage: t(`stages.${stage}`) })),
      }
    );
  };

  const open = isOpenStage(deal.stage);
  const facts: { label: string; value: ReactNode }[] = [
    { label: t('fields.amount'), value: formatYen(deal.amount, locale) ?? t('card.noAmount') },
    { label: t('fields.probability'), value: `${deal.probability}%` },
    {
      label: t('fields.weightedAmount'),
      value: formatYen(deal.weightedAmount, locale),
    },
    { label: t('fields.forecastCategory'), value: t(`forecast.${deal.forecastCategory}`) },
    { label: t('fields.expectedCloseOn'), value: deal.expectedCloseOn ?? t('card.noCloseDate') },
    { label: t('fields.owner'), value: deal.ownerName ?? t('card.unassigned') },
    { label: t('fields.kind'), value: t(`kinds.${deal.kind}`) },
    { label: t('fields.nextStep'), value: deal.nextStep ?? '—' },
  ];
  if (!open) facts.push({ label: t('fields.closedOn'), value: deal.closedOn ?? '—' });
  if (deal.stage === 'lost') {
    facts.push(
      {
        label: t('fields.lostReason'),
        value: deal.lostReason ? <LostReasonLabel reason={deal.lostReason} /> : '—',
      },
      { label: t('fields.lostNote'), value: deal.lostNote ?? '—' }
    );
  }
  if (deal.competitor) facts.push({ label: t('fields.competitor'), value: deal.competitor });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {back}

      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-5 dark:border-gray-800">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">{deal.name}</h1>
            <DealStageBadge stage={deal.stage} />
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            <Link
              href={`/${locale}/leads/${deal.lead.id}`}
              className="underline underline-offset-2"
            >
              {[deal.lead.company, deal.lead.name].filter(Boolean).join(' ') || t('fields.lead')}
            </Link>
          </p>
        </div>
        {(deal.canEdit || deal.canDelete) && (
          <div className="flex gap-2">
            {deal.canEdit && (
              <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {tCommon('edit')}
              </Button>
            )}
            {deal.canDelete && (
              <Button type="button" variant="outline" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {tCommon('delete')}
              </Button>
            )}
          </div>
        )}
      </header>

      <StagePath stage={deal.stage} canEdit={deal.canEdit} onMove={moveTo} />

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="p-5">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-sm text-gray-500 dark:text-gray-400">{fact.label}</dt>
                <dd className="font-medium text-gray-900 dark:text-gray-50">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <aside className="space-y-4">
          {deal.previousDeal && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                {t('detail.previousDeal')}
              </h2>
              <LinkedDealItem deal={deal.previousDeal} />
            </Card>
          )}
          {deal.nextDeals.length > 0 && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                {t('detail.nextDeals')}
              </h2>
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
      </div>

      <Card className="p-5">
        <h2 className="text-base font-bold text-gray-900 dark:text-gray-50">
          {t('detail.history')}
        </h2>
        {deal.history.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">{t('detail.historyEmpty')}</p>
        ) : (
          <ol className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
            {deal.history.map((row) => (
              <HistoryRow key={row.id} row={row} />
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
      />
      <LostReasonDialog
        open={lostOpen}
        onOpenChange={setLostOpen}
        dealName={deal.name}
        initial={{
          lostReason: deal.lostReason ?? undefined,
          lostNote: deal.lostNote,
          competitor: deal.competitor,
        }}
        pending={update.isPending}
        onConfirm={(values) =>
          update.mutate(
            { organizationId, dealId: deal.id, stage: 'lost', ...values },
            {
              onSuccess: () => {
                setLostOpen(false);
                toast.success(t('toasts.moved', { name: deal.name, stage: t('stages.lost') }));
              },
            }
          )
        }
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('detail.deleteDescription', { name: deal.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                remove.mutate(
                  { organizationId, dealId: deal.id },
                  { onSuccess: () => router.push(`/${locale}/deals`) }
                )
              }
            >
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
    <nav aria-label={t('detail.stagePath')}>
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
    </nav>
  );
}

function LinkedDealItem({ deal }: { deal: { id: string; name: string; stage: DealStage } }) {
  const locale = useLocale();
  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      <Link
        href={`/${locale}/deals/${deal.id}`}
        className="truncate text-sm underline underline-offset-2"
      >
        {deal.name}
      </Link>
      <DealStageBadge stage={deal.stage} />
    </div>
  );
}

function HistoryRow({ row }: { row: DealHistoryView }) {
  const t = useTranslations('deals');
  const locale = useLocale();
  const created = row.changedFields.includes('created');
  const fields = row.changedFields
    .filter((field) => field !== 'created')
    .map((field) => (t.has(`historyFields.${field}`) ? t(`historyFields.${field}`) : field));
  const summary = created
    ? t('detail.historyCreated')
    : t('detail.historyChanged', {
        fields: new Intl.ListFormat(locale, { style: 'narrow', type: 'conjunction' }).format(
          fields
        ),
      });
  const values = [
    t(`stages.${row.stage}`),
    formatYen(row.amount, locale) ?? t('card.noAmount'),
    `${row.probability}%`,
    row.expectedCloseOn ?? t('card.noCloseDate'),
    row.ownerName ?? t('card.unassigned'),
  ];
  return (
    <li className="py-2.5 text-sm">
      <p className="text-gray-500 dark:text-gray-400">
        <time dateTime={row.changedAt.toISOString()}>{dateTime(row.changedAt, locale)}</time>
        {row.changedByName && ` · ${row.changedByName}`}
      </p>
      <p className="font-medium text-gray-900 dark:text-gray-50">{summary}</p>
      <p className="text-gray-700 dark:text-gray-300">{values.join(' · ')}</p>
    </li>
  );
}
