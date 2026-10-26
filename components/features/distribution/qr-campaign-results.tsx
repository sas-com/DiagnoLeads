'use client';

import type { QrCampaignBreakdown } from '@/lib/features/analytics/types/schemas';
import { campaignNewLeadRate } from '@/lib/features/distribution/types';
import { ScanLine, Target } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

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
   * From the answers and the leads (analytics.getQrCampaignBreakdown); left out while it loads
   * or when it could not be read, and the counts above are shown without it
   */
  breakdown?: QrCampaignResultsBreakdown;
}

/**
 * The numbers of a QR campaign on the settings page (#700, owner decisions of 2026-10-26): its
 * scans, its new leads and the new-lead rate from the campaign row (campaignNewLeadRate, the
 * rule getCampaignStats answers by too: "—" without scans), a note when there are more new leads
 * than scans, the breakdown of the answers with its code, and one line on what the counts hold.
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
      </dl>

      <dl>
        <dt className="text-muted-foreground">{t('newLeadRate')}</dt>
        <dd className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium tabular-nums">
            {rate === null ? '—' : `${rate.toFixed(1)}%`}
          </span>
          {rate === null && (
            <span className="text-xs text-muted-foreground">{t('rateNotComputable')}</span>
          )}
        </dd>
      </dl>
      {completionCount > scanCount && (
        <p className="text-xs text-muted-foreground">{t('moreNewLeadsThanScans')}</p>
      )}

      {breakdown && (
        <div className="space-y-1 rounded-md bg-muted/50 px-3 py-2">
          <p className="text-xs text-muted-foreground">{t('breakdown')}</p>
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
          <dl className="border-t pt-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <dt>{t('existingLeadAnswers')}</dt>
              <dd className="font-medium tabular-nums">
                {format.number(breakdown.existingLeadAnswers)}
              </dd>
              <dd className="text-xs text-muted-foreground">{t('existingLeadAnswersHint')}</dd>
            </div>
          </dl>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t('caveat', {
          date: format.dateTime(createdAt, { dateStyle: 'medium', timeZone: 'Asia/Tokyo' }),
        })}
      </p>
    </div>
  );
}
