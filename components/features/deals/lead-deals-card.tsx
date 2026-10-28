'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { isOpenStage } from '@/lib/features/deals/types/pipeline';
import { trpc } from '@/lib/trpc/client';
import { Briefcase, Loader2, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { DealFormDialog } from './deal-form-dialog';
import { formatDealDate, formatYen } from './deal-format';
import { DealStageBadge } from './deal-stage-badge';

/** The day that matters for the deal, named: when it should close, or when it closed (#720) */
function DealDay({
  deal,
}: { deal: { stage: string; expectedCloseOn: string | null; closedOn: string | null } }) {
  const t = useTranslations('deals');
  if (isOpenStage(deal.stage)) {
    return deal.expectedCloseOn
      ? t('leadCard.expectedClose', { date: formatDealDate(deal.expectedCloseOn) })
      : t('card.noCloseDate');
  }
  const date = deal.closedOn ? formatDealDate(deal.closedOn) : '—';
  return deal.stage === 'won' ? t('leadCard.wonOn', { date }) : t('leadCard.lostOn', { date });
}

/**
 * The deals of a lead on its page (Refs #436): each with its stage, amount and expected close
 * date, the open amount in total, and creating one for this lead.
 */
export function LeadDealsCard({
  organizationId,
  leadId,
}: { organizationId: string; leadId: string }) {
  const t = useTranslations('deals');
  const locale = useLocale();
  const [createOpen, setCreateOpen] = useState(false);
  const query = trpc.deals.forLead.useQuery(
    { organizationId, leadId },
    { enabled: !!organizationId }
  );
  const data = query.data;
  const openAmount = (data?.items ?? [])
    .filter((deal) => isOpenStage(deal.stage))
    .reduce((sum, deal) => sum + (deal.amount ?? 0), 0);

  // A parent organization's viewer may read the lead but not its deals: no card, like the
  // playbook cards (lib/features/deals/access.ts)
  if (query.error?.data?.code === 'FORBIDDEN') return null;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Briefcase className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">{t('leadCard.title')}</h2>
        {data && data.items.length > 0 && (
          <Badge color="gray" className="text-sm">
            {data.items.length}
          </Badge>
        )}
        {data?.canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={`ml-auto ${TAP_TARGET}`}
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            {t('create')}
          </Button>
        )}
      </div>

      {query.isError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {t('state.loadError')}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={TAP_TARGET}
            onClick={() => void query.refetch()}
          >
            {t('state.retry')}
          </Button>
        </div>
      ) : !data ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('leadCard.empty')}</p>
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">
            {t('leadCard.summary', {
              count: data.items.length,
              amount: formatYen(openAmount, locale) ?? '',
            })}
          </p>
          <ul className="divide-y">
            {data.items.map((deal) => (
              <li key={deal.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                {/* 44px on phones by its padding; underlined, so a touch screen shows it is a link */}
                <Link
                  href={`/${locale}/deals/${deal.id}`}
                  className="block min-w-0 flex-1 truncate py-3 text-sm font-medium underline underline-offset-2 md:py-0"
                >
                  {deal.name}
                </Link>
                <DealStageBadge stage={deal.stage} />
                <span className="text-sm tabular-nums text-foreground">
                  {formatYen(deal.amount, locale) ?? t('card.noAmount')}
                </span>
                <span className="text-sm text-muted-foreground">
                  <DealDay deal={deal} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {data?.canEdit && (
        <DealFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          organizationId={organizationId}
          leadId={leadId}
        />
      )}
    </Card>
  );
}
