'use client';

import { Skeleton } from '@/components/ui/skeleton';
import type { QrCampaignBreakdown } from '@/lib/features/analytics/types/schemas';
import { campaignNewLeadRate } from '@/lib/features/distribution/types';
import { Percent, ScanLine, Target } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId } from 'react';

/** What the answers carrying the campaign's code add, without the campaign's id */
export type QrCampaignResultsBreakdown = Omit<QrCampaignBreakdown, 'campaignId'>;

interface QrCampaignResultsProps {
  /** The scans the /q/ entry recorded (qr_campaigns.scan_count) */
  scanCount: number;
  /** The new leads counted by the short code (qr_campaigns.completion_count) */
  completionCount: number;
  /** The campaign's creation: the counts run from it */
  createdAt: Date;
  /**
   * From the answers and the leads (analytics.getQrCampaignBreakdown), or where it stands while
   * it is not there: 'loading', or 'unavailable' when it could not be read. The counts above are
   * shown either way
   */
  breakdown: QrCampaignResultsBreakdown | 'loading' | 'unavailable';
}

/**
 * The numbers of a QR campaign on the settings page (#700, owner decisions of 2026-10-26): its
 * scans, its new leads and the new-lead rate from the campaign row (campaignNewLeadRate, the
 * rule getCampaignStats answers by too: "—" without scans), a note when there are more new leads
 * than scans, the breakdown of the new leads, the answers of existing leads apart from it (they
 * are not new leads), and one line on what the counts hold.
 * Named 新規リード, never コンバージョン: the lead list uses that word for won deals
 */
export function QrCampaignResults({
  scanCount,
  completionCount,
  createdAt,
  breakdown,
}: QrCampaignResultsProps) {
  const t = useTranslations('settings.qrCampaigns.results');
  const format = useFormatter();
  const breakdownHeadingId = useId();
  const rate = campaignNewLeadRate({ scanCount, completionCount });

  return (
    <div className="space-y-2 text-sm">
      <dl className="flex flex-wrap gap-x-4 gap-y-1">
        <div className="flex items-center gap-2">
          <ScanLine className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dt className="text-muted-foreground">{t('scans')}</dt>
          <dd className="font-medium tabular-nums">{format.number(scanCount)}</dd>
        </div>
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dt className="text-muted-foreground">{t('newLeads')}</dt>
          <dd className="font-medium tabular-nums">{format.number(completionCount)}</dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Percent
            className="h-4 w-4 shrink-0 self-center text-muted-foreground"
            aria-hidden="true"
          />
          <dt className="text-muted-foreground">{t('newLeadRate')}</dt>
          <dd className="flex flex-wrap items-baseline gap-x-2">
            {rate === null ? (
              // The reason next to it is what a screen reader reads
              <span className="font-medium" aria-hidden="true">
                —
              </span>
            ) : (
              <span className="font-medium tabular-nums">
                {/* Rounded once already (campaignNewLeadRate); grouped like the counts */}
                {`${format.number(rate, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
              </span>
            )}
            {rate === null && (
              <span className="text-xs text-muted-foreground">{t('rateNotComputable')}</span>
            )}
          </dd>
        </div>
      </dl>
      {completionCount > scanCount && (
        <p className="text-xs text-muted-foreground">{t('moreNewLeadsThanScans')}</p>
      )}

      {breakdown === 'loading' && <Skeleton className="h-16 w-full" />}
      {breakdown === 'unavailable' && (
        <p className="text-xs text-muted-foreground">{t('breakdownUnavailable')}</p>
      )}
      {typeof breakdown === 'object' && (
        <>
          {/* The new leads only: the answers of existing leads are not part of them */}
          <fieldset
            aria-labelledby={breakdownHeadingId}
            className="min-w-0 space-y-1 rounded-md border p-3"
          >
            <p id={breakdownHeadingId} className="text-xs text-muted-foreground">
              {t('breakdown')}
            </p>
            <dl className="flex flex-wrap gap-x-4 gap-y-1">
              <div className="flex items-baseline gap-2">
                <dt>{t('interested')}</dt>
                <dd className="font-medium tabular-nums">
                  {format.number(breakdown.interestedNewLeads)}
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt>{t('consultation')}</dt>
                <dd className="font-medium tabular-nums">
                  {format.number(breakdown.consultationNewLeads)}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">{t('breakdownHint')}</p>
            {/* Only a new lead the count missed (the savepoint) is here and not in completion_count */}
            {(breakdown.interestedNewLeads > completionCount ||
              breakdown.consultationNewLeads > completionCount) && (
              <p className="text-xs text-muted-foreground">{t('breakdownOverNewLeads')}</p>
            )}
          </fieldset>

          <div className="space-y-1">
            <dl>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <dt>{t('existingLeadAnswers')}</dt>
                <dd className="font-medium tabular-nums">
                  {format.number(breakdown.existingLeadAnswers)}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">{t('existingLeadAnswersHint')}</p>
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        {t('caveat', {
          date: format.dateTime(createdAt, { dateStyle: 'medium', timeZone: 'Asia/Tokyo' }),
        })}
      </p>
    </div>
  );
}
