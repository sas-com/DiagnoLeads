'use client';

import type { ConversionFunnelData, FunnelStageName } from '@/lib/features/analytics/types/schemas';
import { LEAD_STATUSES, type LeadStatus } from '@/lib/features/leads/types/pipeline';
import { cn } from '@/lib/utils';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';

const STAGE_COLORS: Record<FunnelStageName, { color: string; bgColor: string }> = {
  lead: { color: 'bg-blue-500', bgColor: 'bg-blue-100' },
  mql: { color: 'bg-emerald-500', bgColor: 'bg-emerald-100' },
  deal: { color: 'bg-yellow-500', bgColor: 'bg-yellow-100' },
  sql: { color: 'bg-green-500', bgColor: 'bg-green-100' },
  won: { color: 'bg-purple-500', bgColor: 'bg-purple-100' },
};
const STATUS_TEXT_COLORS: Record<LeadStatus, string> = {
  new: 'text-blue-600',
  nurturing: 'text-yellow-600',
  negotiating: 'text-green-600',
  won: 'text-purple-600',
  lost: 'text-gray-600',
};

interface ConversionFunnelProps {
  leadsByStatus?: Record<LeadStatus, number>;
  funnelData?: ConversionFunnelData;
  isLoading?: boolean;
}

interface FunnelStageDisplay {
  label: string;
  value: number;
  percentage: number;
  conversionRate: number;
  color: string;
  bgColor: string;
}

/**
 * ConversionFunnel - the stages of the lead lifecycle (#802): リード → MQL → 商談 → SQL → 受注.
 * A lead counts for every stage before the one it reached. Leads nurtured now (再育成) are a side
 * way, shown under the funnel, not as a stage.
 */
export function ConversionFunnel({
  leadsByStatus,
  funnelData: apiFunnelData,
  isLoading = false,
}: ConversionFunnelProps) {
  const t = useTranslations('settings.analytics');
  const tStatus = useTranslations('status');
  const format = useFormatter();

  const displayData = useMemo((): FunnelStageDisplay[] => {
    if (!apiFunnelData || apiFunnelData.totalLeads === 0) return [];
    return apiFunnelData.stages.map((stage) => ({
      label: t(`funnel.stages.${stage.name}`),
      value: stage.cumulativeCount,
      percentage: stage.percentage,
      conversionRate: stage.conversionRate,
      ...STAGE_COLORS[stage.name],
    }));
  }, [apiFunnelData, t]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders that are never reordered and have no identity
          <div key={i} className="animate-pulse">
            <div className="h-16 bg-gray-200 rounded" style={{ width: `${100 - i * 15}%` }} />
          </div>
        ))}
      </div>
    );
  }

  if (displayData.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <p className="text-gray-500">{t('noData')}</p>
      </div>
    );
  }

  const maxValue = displayData[0]?.value || 1;

  return (
    <div className="space-y-6">
      {/* Funnel Visualization */}
      <div className="space-y-3">
        {displayData.map((stage, index) => (
          <div key={stage.label} className="relative">
            {/* Stage bar */}
            <div
              className={cn('relative h-16 rounded-lg transition-all duration-500', stage.bgColor)}
              style={{ width: `${Math.max(20, (stage.value / maxValue) * 100)}%` }}
            >
              <div
                className={cn(
                  'absolute inset-y-0 left-0 rounded-lg transition-all duration-500',
                  stage.color
                )}
                style={{ width: `${stage.percentage}%`, minWidth: '4px' }}
              />

              {/* Label and value */}
              <div className="absolute inset-0 flex items-center justify-between px-4">
                <span className="font-medium text-gray-900">{stage.label}</span>
                <div className="flex items-center gap-3 text-sm">
                  <span className="font-semibold text-gray-900">{format.number(stage.value)}</span>
                  <span className="text-gray-600">({stage.percentage.toFixed(1)}%)</span>
                </div>
              </div>
            </div>

            {/* Conversion rate arrow */}
            {index > 0 && (
              <div className="absolute -top-2 right-4 flex items-center gap-1 text-xs">
                <svg
                  aria-hidden="true"
                  className="w-3 h-3 text-gray-400 rotate-180"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 15l7-7 7 7"
                  />
                </svg>
                <span
                  className={cn(
                    'font-medium',
                    stage.conversionRate >= 50
                      ? 'text-green-600'
                      : stage.conversionRate >= 25
                        ? 'text-yellow-600'
                        : 'text-red-600'
                  )}
                >
                  {stage.conversionRate.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 再育成 is a side way, not a stage (#802) */}
      {apiFunnelData && (
        <p className="text-sm text-gray-600" data-testid="funnel-nurturing">
          {t('funnel.nurturingNow', { count: apiFunnelData.nurturingCount })}
        </p>
      )}
      <p className="text-xs text-gray-500">{t('funnel.reachedNote')}</p>

      {/* Summary Stats */}
      {leadsByStatus && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-4 border-t border-gray-200">
          {LEAD_STATUSES.map((status) => (
            <div key={status} className="text-center">
              <p className={cn('text-2xl font-bold', STATUS_TEXT_COLORS[status])}>
                {leadsByStatus[status]}
              </p>
              <p className="text-xs text-gray-500">{tStatus(status)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Overall Conversion Rate */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-lg border border-gray-200">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">{t('funnel.overallConversion')}</span>
          <span className="text-2xl font-bold text-purple-600">
            {(apiFunnelData?.overallConversionRate ?? 0).toFixed(1)}%
          </span>
        </div>
        {apiFunnelData && apiFunnelData.averageConversionDays > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            {t('funnel.averageDays', {
              days: format.number(apiFunnelData.averageConversionDays, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }),
            })}
          </p>
        )}
        {(!apiFunnelData || apiFunnelData.averageConversionDays === 0) && (
          <p className="text-xs text-gray-500 mt-1">{t('funnel.fromInitial')}</p>
        )}
      </div>
    </div>
  );
}
