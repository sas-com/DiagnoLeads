'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { AddNextActionDialog } from '@/components/features/lead-follow-up/add-next-action-dialog';
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
import { useRowDialog } from '@/hooks/use-row-dialog';
import type { DealCard } from '@/lib/features/deals/service';
import { DEAL_KINDS, type DealKind } from '@/lib/features/deals/types/pipeline';
import { BOARD_CLOSED_DAYS_DEFAULT, BOARD_DEALS_LIMIT } from '@/lib/features/deals/types/schemas';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
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

/** The name of a deal on its board card or list row (data-deal-link), which takes the focus */
function dealLinkOf(dealId: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-deal-link]')).find(
    (link) => link.dataset.dealLink === dealId
  );
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
 * loading rather than that there are no deals (#720). An open deal whose lead has no next action
 * offers to add one in a dialog, to those who may change deals (#853). When what had the focus
 * on the board goes with a read, the focus goes to the failure's retry, to the deal's name it was
 * taken from once a retry brings the board back, or to the screen's heading, rather than to the
 * page (#1011).
 */
export function DealsScreen() {
  const t = useTranslations('deals');
  const tCommon = useTranslations('common');
  const filterId = useId();
  // Focusable by script: where the focus goes when what had it on the board is gone (#1011)
  const headingId = useId();
  // The failure's retry, read with what failed: where the focus goes when the board could not be
  // read; and the deal whose name it was taken from, given back once the retry brings the board
  // back (#1011)
  const retryButton = useRef<HTMLButtonElement>(null);
  const loadErrorId = useId();
  const dealBeforeError = useRef<string | undefined>(undefined);
  const { organizationId: contextOrgId } = useOrganization();
  const organizationId = contextOrgId && UUID.test(contextOrgId) ? contextOrgId : '';
  const { view, owner, kind, period, sort, set, update } = useBoardQuery();
  const today = jstDate();
  const [createOpen, setCreateOpen] = useState(false);
  // The dialog that creates a deal is opened from the header's button or the empty board's, not
  // from a dialog trigger: the focus goes back to that button. The first deal takes the empty
  // board's away: the focus goes to the new deal's name then (#1028)
  const createOpener = useRef<HTMLElement | null>(null);
  const createdDeal = useRef<string | undefined>(undefined);
  const startCreate = (from: HTMLElement) => {
    createOpener.current = from;
    createdDeal.current = undefined;
    setCreateOpen(true);
  };
  // Clearing the filters takes away its button: the focus goes to the first filter
  const ownerTrigger = useRef<HTMLButtonElement>(null);
  // A move's question closes with its card's move button gone (the board could not be read, or
  // was read again, or the deal left it): as when a next action was added, the focus goes to the
  // deal's name, else to the retry, which gives it to the deal's name once it brings the board
  // back, or else to the screen's heading (#1026)
  const stageMove = useStageMove(organizationId, (deal) => {
    const name = dealLinkOf(deal.id);
    if (name) return name;
    if (retryButton.current) {
      dealBeforeError.current = deal.id;
      return retryButton.current;
    }
    return document.getElementById(headingId);
  });
  // The dialog that adds a deal's next action from its card or row (#853): one, for the deal
  // chosen, outside the board (#998). Closed without adding, the focus goes back to the button;
  // once added, the button goes away with the board read again, so the focus goes to the deal's
  // name on its card or row, under which the next action then shows. Neither is there when the
  // board could not be read meanwhile: the focus goes to the failure's retry then, and to the
  // deal's name once the retry brings the board back (#1011)
  const nextAction = useRowDialog<DealCard>(({ chosen, done, opener }) => {
    const back = !done && opener ? opener : dealLinkOf(chosen.id);
    if (back) return back;
    if (retryButton.current) {
      dealBeforeError.current = chosen.id;
      return retryButton.current;
    }
    return document.getElementById(headingId);
  });

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

  // What the board's place shows, which a read changes: what had the focus in it goes then (a
  // deal's name once the read after adding its next action failed, the retry once it brought the
  // board back), and the focus with it, to the page. It goes to the failure's retry instead, to
  // the deal's name it was taken from once the board is back, or else to the screen's heading;
  // not when it had moved out of the board before (#1011)
  const boardShows = board.isError ? 'error' : !data || readingOthers ? 'loading' : 'board';
  const focusedOnBoard = useRef<Element | null>(null);
  useEffect(() => {
    const last = focusedOnBoard.current;
    const lostDeal = dealBeforeError.current;
    if (boardShows !== 'error') dealBeforeError.current = undefined;
    if (!last || last.isConnected) return;
    // After a menu or a select that went with the board gives the focus back on its own (a
    // timeout), when the page is no longer hidden behind it from screen readers
    const timer = window.setTimeout(() => {
      if (focusedOnBoard.current !== last) return;
      focusedOnBoard.current = null;
      const active = document.activeElement;
      if (active && active !== document.body) return;
      if (boardShows === 'error' && retryButton.current) {
        if (last instanceof HTMLElement && last.dataset.dealLink) {
          dealBeforeError.current = last.dataset.dealLink;
        }
        retryButton.current.focus();
        return;
      }
      const back = boardShows === 'board' && lostDeal ? dealLinkOf(lostDeal) : undefined;
      (back ?? document.getElementById(headingId))?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [boardShows, headingId]);

  if (board.error?.data?.code === 'FORBIDDEN') {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6 py-1 sm:px-2 sm:py-6">
        <StudioPageHeader title={t('title')} headingId={headingId} />
        <DealsForbidden />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 py-1 sm:px-2 sm:py-6">
      <StudioPageHeader
        title={t('title')}
        headingId={headingId}
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
                <Button
                  type="button"
                  className={TAP_TARGET}
                  onClick={(event) => startCreate(event.currentTarget)}
                >
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

          {/* What a read replaces: the board, its failure or the loading. What had the focus
              in it is kept, to tell when it went with a read (#1011) */}
          <div
            onFocus={(event) => {
              focusedOnBoard.current = event.target;
            }}
          >
            {board.isError ? (
              <div
                role="alert"
                className="space-y-2 rounded-lg border border-red-200 bg-white p-4 dark:border-red-900 dark:bg-gray-900"
              >
                <p id={loadErrorId} className="text-sm text-red-700 dark:text-red-400">
                  {t('state.loadError')}
                </p>
                <Button
                  ref={retryButton}
                  type="button"
                  variant="outline"
                  className={TAP_TARGET}
                  aria-describedby={loadErrorId}
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
                        onClick={(event) => startCreate(event.currentTarget)}
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
                    onAddNextAction={nextAction.start}
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
                    canEdit={data.canEdit}
                    onAddNextAction={nextAction.start}
                  />
                )}
              </div>
            )}
          </div>

          {data?.canEdit && (
            <DealFormDialog
              open={createOpen}
              onOpenChange={setCreateOpen}
              organizationId={organizationId}
              onSaved={(deal) => {
                createdDeal.current = deal.id;
              }}
              onCloseAutoFocus={(event) => {
                const opener = createOpener.current?.isConnected ? createOpener.current : null;
                const created = createdDeal.current;
                let target: HTMLElement | null | undefined =
                  opener ?? (created ? dealLinkOf(created) : undefined);
                // Neither the button nor the new deal is there when the board could not be
                // read, or the filters leave the deal out: as when a next action was added,
                // the retry gives the focus to the new deal once it brings the board back
                if (!target && retryButton.current) {
                  dealBeforeError.current = created;
                  target = retryButton.current;
                }
                target ??= document.getElementById(headingId);
                if (!target) return;
                event.preventDefault();
                target.focus();
              }}
            />
          )}
          {data?.canEdit && nextAction.chosen && (
            <AddNextActionDialog
              open={nextAction.open}
              onOpenChange={nextAction.setOpen}
              organizationId={organizationId}
              deal={nextAction.chosen}
              leadLabel={nextAction.chosen.company || nextAction.chosen.leadName || ''}
              today={data.today}
              onAdded={nextAction.markDone}
              onCloseAutoFocus={nextAction.returnFocus}
            />
          )}
          {stageMove.dialogs}
        </>
      )}
    </div>
  );
}
