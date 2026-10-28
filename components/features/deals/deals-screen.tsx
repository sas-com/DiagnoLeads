'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { StudioPageHeader } from '@/components/studio';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useOrganization } from '@/hooks/use-organization';
import { DEAL_KINDS, type DealKind } from '@/lib/features/deals/types/pipeline';
import { BOARD_CLOSED_DAYS_DEFAULT, BOARD_DEALS_LIMIT } from '@/lib/features/deals/types/schemas';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useId, useMemo, useRef, useState } from 'react';
import { DealBoard } from './deal-board';
import { DealFormDialog } from './deal-form-dialog';
import { DEAL_PERIODS, type DealPeriod, isDealPeriod, periodRange } from './deal-format';
import {
  DEAL_SORT_PARAMS,
  dealSortParams,
  nextDealSort,
  parseDealSort,
  sortDeals,
} from './deal-list-sort';
import { DealTable } from './deal-table';
import { DealsForbidden } from './deals-forbidden';
import { applyPendingMoves } from './pending-moves';
import { useStageMove } from './use-stage-move';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEWS = ['board', 'list'] as const;
type View = (typeof VIEWS)[number];
const ALL = 'all' as const;

/**
 * The board's state lives in the URL, so a filtered board or a sorted list can be shared or
 * reopened (the forecast links its overdue deals to the list sorted by close date)
 */
function useBoardQuery() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view: View = params.get('view') === 'list' ? 'list' : 'board';
  const ownerParam = params.get('owner');
  const owner = ownerParam === 'mine' || (ownerParam && UUID.test(ownerParam)) ? ownerParam : ALL;
  const kindParam = params.get('kind');
  const kind: DealKind | typeof ALL = (DEAL_KINDS as readonly string[]).includes(kindParam ?? '')
    ? (kindParam as DealKind)
    : ALL;
  const periodParam = params.get('period');
  const period: DealPeriod = isDealPeriod(periodParam) ? periodParam : 'all';
  const sort = parseDealSort(params.get(DEAL_SORT_PARAMS.by), params.get(DEAL_SORT_PARAMS.order));

  /** Set the params given, removing those given as null, and keep the others */
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const search = next.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };
  const set = (key: string, value: string, fallback: string) =>
    update({ [key]: value === fallback ? null : value });
  return { view, owner, kind, period, sort, set, update };
}

/** The place of the board when it has nothing to show, with what to do next */
function EmptyState({
  title,
  hint,
  children,
}: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
      {/* A heading, like the board's columns it stands for */}
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">{title}</h2>
      {hint && <p className="text-sm text-gray-600 dark:text-gray-300">{hint}</p>}
      {children}
    </div>
  );
}

/**
 * The deals screen (Refs #436): the pipeline board or the same deals as a list, filtered by
 * owner, kind and expected close period; deals are created here (choosing the lead) or from a
 * lead's page. A move between open stages shows at once (#720); the list sorts by amount or
 * expected close date (in the URL), and the board's order otherwise. While the deals of other
 * filters are read, the previous ones stay in view, unless there were none: then it says it is
 * loading rather than that there are no deals (#720).
 */
export function DealsScreen() {
  const t = useTranslations('deals');
  const tCommon = useTranslations('common');
  const filterId = useId();
  const { organizationId: contextOrgId } = useOrganization();
  const organizationId = contextOrgId && UUID.test(contextOrgId) ? contextOrgId : '';
  const { view, owner, kind, period, sort, set, update } = useBoardQuery();
  const today = jstDate();
  const [createOpen, setCreateOpen] = useState(false);
  // Clearing the filters takes away its button: the focus goes to the first filter
  const ownerTrigger = useRef<HTMLButtonElement>(null);
  const stageMove = useStageMove(organizationId);

  const board = trpc.deals.board.useQuery(
    {
      organizationId,
      owner,
      ...(kind === ALL ? {} : { kinds: [kind] }),
      ...periodRange(period, today),
    },
    { enabled: !!organizationId, placeholderData: (previous) => previous }
  );
  const members = trpc.leads.assignees.useQuery({ organizationId }, { enabled: !!organizationId });
  const data = board.data;
  // The moves on their way to the server are shown already
  const pending = stageMove.pending;
  const columns = useMemo(
    () => (data ? applyPendingMoves(data.columns, pending) : []),
    [data, pending]
  );
  const total = columns.reduce((sum, column) => sum + column.count, 0);
  const filtered = owner !== ALL || kind !== ALL || period !== 'all';
  // The previous filters' empty board would say there are no deals while the new ones are read
  const readingOthers = board.isPlaceholderData && total === 0;

  if (board.error?.data?.code === 'FORBIDDEN') {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6 py-1 sm:px-2 sm:py-6">
        <StudioPageHeader title={t('title')} />
        <DealsForbidden />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 py-1 sm:px-2 sm:py-6">
      <StudioPageHeader
        title={t('title')}
        description={
          data && !data.canEdit ? (
            <>
              {t('description')}
              {/* Those who cannot change deals are told why, under what the screen is for */}
              <span className="mt-1 block">{t('state.readOnlyHint')}</span>
            </>
          ) : (
            t('description')
          )
        }
        actions={
          organizationId && (
            <>
              <ToggleGroup
                type="single"
                size="sm"
                value={view}
                onValueChange={(value) => value && set('view', value, 'board')}
                aria-label={t('views.label')}
                className="rounded-md border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900"
              >
                {VIEWS.map((value) => (
                  <ToggleGroupItem key={value} value={value} className={TAP_TARGET}>
                    {t(`views.${value}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {data && !data.canEdit && (
                <Badge color="gray" className="text-sm">
                  {t('state.readOnly')}
                </Badge>
              )}
              {data?.canEdit && (
                <Button type="button" className={TAP_TARGET} onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t('create')}
                </Button>
              )}
            </>
          )
        }
      />

      {!organizationId ? null : (
        <>
          <fieldset className="flex flex-wrap items-end gap-3">
            <legend className="sr-only">{t('filters.label')}</legend>
            <div className="space-y-1">
              <Label htmlFor={`${filterId}-owner`}>{t('filters.owner')}</Label>
              <Select value={owner} onValueChange={(value) => set('owner', value, ALL)}>
                <SelectTrigger
                  ref={ownerTrigger}
                  id={`${filterId}-owner`}
                  className={cn('w-44', TAP_TARGET)}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('filters.all')}</SelectItem>
                  <SelectItem value="mine">{t('filters.mine')}</SelectItem>
                  {(members.data ?? []).map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {member.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${filterId}-kind`}>{t('filters.kind')}</Label>
              <Select value={kind} onValueChange={(value) => set('kind', value, ALL)}>
                <SelectTrigger id={`${filterId}-kind`} className={cn('w-44', TAP_TARGET)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('filters.allKinds')}</SelectItem>
                  {DEAL_KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`kinds.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span id={`${filterId}-period`} className="text-sm font-medium">
                {t('filters.period')}
              </span>
              <ToggleGroup
                type="single"
                size="sm"
                value={period}
                onValueChange={(value) => value && set('period', value, 'all')}
                aria-labelledby={`${filterId}-period`}
                className="rounded-md border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900"
              >
                {DEAL_PERIODS.map((value) => (
                  <ToggleGroupItem key={value} value={value} className={TAP_TARGET}>
                    {t(`filters.periods.${value}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </fieldset>

          {board.isError ? (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-red-200 bg-white p-4 dark:border-red-900 dark:bg-gray-900"
            >
              <p className="text-sm text-red-700 dark:text-red-400">{t('state.loadError')}</p>
              <Button
                type="button"
                variant="outline"
                className={TAP_TARGET}
                onClick={() => void board.refetch()}
              >
                {t('state.retry')}
              </Button>
            </div>
          ) : !data || readingOthers ? (
            <div
              className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"
              aria-busy="true"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {tCommon('loading')}
            </div>
          ) : (
            <div
              aria-busy={board.isPlaceholderData}
              className={board.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}
            >
              {data.truncated && (
                // biome-ignore lint/a11y/useSemanticElements: live-region notice, not a form output
                <p role="status" className="mb-3 text-sm text-amber-800 dark:text-amber-400">
                  {t('state.truncated', { limit: BOARD_DEALS_LIMIT })}
                </p>
              )}
              {total === 0 && filtered ? (
                <EmptyState title={t('state.noMatch')}>
                  <Button
                    type="button"
                    variant="outline"
                    className={TAP_TARGET}
                    onClick={() => {
                      update({ owner: null, kind: null, period: null });
                      ownerTrigger.current?.focus();
                    }}
                  >
                    {t('state.clearFilters')}
                  </Button>
                </EmptyState>
              ) : total === 0 ? (
                <EmptyState
                  title={t('state.empty')}
                  hint={data.canEdit ? t('state.emptyHint') : t('state.emptyHintReadOnly')}
                >
                  {data.canEdit && (
                    // Outlined: the header's button is the screen's filled one
                    <Button
                      type="button"
                      variant="outline"
                      className={TAP_TARGET}
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {t('create')}
                    </Button>
                  )}
                </EmptyState>
              ) : view === 'board' ? (
                <DealBoard
                  columns={columns}
                  today={data.today}
                  // The board is read with the API's default (closedWithinDays is not sent)
                  closedWithinDays={BOARD_CLOSED_DAYS_DEFAULT}
                  canEdit={data.canEdit}
                  onMove={(deal, stage, options) =>
                    stageMove.move(
                      { ...deal, leadLabel: deal.company || deal.leadName || '' },
                      stage,
                      options
                    )
                  }
                />
              ) : (
                <DealTable
                  deals={sortDeals(
                    columns.flatMap((column) => column.deals),
                    sort
                  )}
                  today={data.today}
                  closedWithinDays={BOARD_CLOSED_DAYS_DEFAULT}
                  sort={sort}
                  onSort={(column) => update(dealSortParams(nextDealSort(sort, column)))}
                />
              )}
            </div>
          )}

          {data?.canEdit && (
            <DealFormDialog
              open={createOpen}
              onOpenChange={setCreateOpen}
              organizationId={organizationId}
            />
          )}
          {stageMove.dialogs}
        </>
      )}
    </div>
  );
}
