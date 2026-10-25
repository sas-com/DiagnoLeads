'use client';

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
import { Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useState } from 'react';
import { DealBoard } from './deal-board';
import { DealFormDialog } from './deal-form-dialog';
import { DEAL_PERIODS, type DealPeriod, isDealPeriod, periodRange } from './deal-format';
import { DealTable } from './deal-table';
import { DealsForbidden } from './deals-forbidden';
import { useStageMove } from './use-stage-move';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEWS = ['board', 'list'] as const;
type View = (typeof VIEWS)[number];
const ALL = 'all' as const;

/** The board's state lives in the URL, so a filtered board can be shared or reopened */
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

  const set = (key: string, value: string, fallback: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    const search = next.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };
  return { view, owner, kind, period, set };
}

/**
 * The deals screen (Refs #436): the pipeline board or the same deals as a list, filtered by
 * owner, kind and expected close period; deals are created here (choosing the lead) or from a
 * lead's page.
 */
export function DealsScreen() {
  const t = useTranslations('deals');
  const tCommon = useTranslations('common');
  const filterId = useId();
  const { organizationId: contextOrgId } = useOrganization();
  const organizationId = contextOrgId && UUID.test(contextOrgId) ? contextOrgId : '';
  const { view, owner, kind, period, set } = useBoardQuery();
  const today = jstDate();
  const [createOpen, setCreateOpen] = useState(false);
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
  const total = data?.columns.reduce((sum, column) => sum + column.count, 0) ?? 0;
  const cards = data?.columns.flatMap((column) => column.deals) ?? [];

  if (board.error?.data?.code === 'FORBIDDEN') {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6 py-1 sm:px-2 sm:py-6">
        <h1 className="text-2xl font-bold tracking-wide text-gray-900 sm:text-[2rem] dark:text-gray-50">
          {t('title')}
        </h1>
        <DealsForbidden />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 py-1 sm:px-2 sm:py-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-gray-200 pb-5 dark:border-gray-800">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-wide text-gray-900 sm:text-[2rem] dark:text-gray-50">
            {t('title')}
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('description')}</p>
        </div>
        {organizationId && (
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              size="sm"
              value={view}
              onValueChange={(value) => value && set('view', value, 'board')}
              aria-label={t('views.label')}
              className="rounded-md border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900"
            >
              {VIEWS.map((value) => (
                <ToggleGroupItem key={value} value={value}>
                  {t(`views.${value}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {data && !data.canEdit && <Badge color="gray">{t('state.readOnly')}</Badge>}
            {data?.canEdit && (
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t('create')}
              </Button>
            )}
          </div>
        )}
      </header>

      {!organizationId ? null : (
        <>
          <fieldset className="flex flex-wrap items-end gap-3">
            <legend className="sr-only">{t('filters.label')}</legend>
            <div className="space-y-1">
              <Label htmlFor={`${filterId}-owner`}>{t('filters.owner')}</Label>
              <Select value={owner} onValueChange={(value) => set('owner', value, ALL)}>
                <SelectTrigger id={`${filterId}-owner`} className="w-44">
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
                <SelectTrigger id={`${filterId}-kind`} className="w-44">
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
                  <ToggleGroupItem key={value} value={value}>
                    {t(`filters.periods.${value}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </fieldset>

          {board.isError ? (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-red-200 p-4 dark:border-red-900"
            >
              <p className="text-sm text-red-700 dark:text-red-400">{t('state.loadError')}</p>
              <Button type="button" variant="outline" onClick={() => void board.refetch()}>
                {t('state.retry')}
              </Button>
            </div>
          ) : !data ? (
            <div className="flex items-center gap-2 text-sm text-gray-500" aria-busy="true">
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
                <p role="status" className="mb-3 text-sm text-amber-700 dark:text-amber-400">
                  {t('state.truncated', { limit: BOARD_DEALS_LIMIT })}
                </p>
              )}
              {total === 0 && owner === ALL && kind === ALL && period === 'all' ? (
                <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
                  <p className="font-semibold text-gray-900 dark:text-gray-50">
                    {t('state.empty')}
                  </p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {t('state.emptyHint')}
                  </p>
                </div>
              ) : view === 'board' ? (
                <DealBoard
                  columns={data.columns}
                  today={data.today}
                  // The board is read with the API's default (closedWithinDays is not sent)
                  closedWithinDays={BOARD_CLOSED_DAYS_DEFAULT}
                  canEdit={data.canEdit}
                  onMove={(deal, stage) =>
                    stageMove.move(
                      { ...deal, leadLabel: deal.company || deal.leadName || '' },
                      stage
                    )
                  }
                />
              ) : (
                <DealTable deals={cards} today={data.today} />
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
