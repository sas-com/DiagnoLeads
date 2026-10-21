'use client';

import type { ConversionFunnelData } from '@/lib/features/analytics/types/schemas';
import { LEAD_STATUSES, type LeadStatus } from '@/lib/features/leads/types/pipeline';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

const STAGE_COLORS: Record<string, { color: string; bgColor: string; textColor: string }> = {
  new: { color: 'bg-blue-500', bgColor: 'bg-blue-100', textColor: 'text-blue-600' },
  nurturing: { color: 'bg-yellow-500', bgColor: 'bg-yellow-100', textColor: 'text-yellow-600' },
  negotiating: { color: 'bg-green-500', bgColor: 'bg-green-100', textColor: 'text-green-600' },
  won: { color: 'bg-purple-500', bgColor: 'bg-purple-100', textColor: 'text-purple-600' },
  lost: { color: 'bg-gray-400', bgColor: 'bg-gray-100', textColor: 'text-gray-600' },
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
 * ConversionFunnel - Visual representation of lead conversion stages
 */
export function ConversionFunnel({
  leadsByStatus,
  funnelData: apiFunnelData,
  isLoading = false,
}: ConversionFunnelProps) {
  const tStatus = useTranslations('status');

  const displayData = useMemo((): FunnelStageDisplay[] => {
    // Prefer API funnel data if available
    if (apiFunnelData && apiFunnelData.stages.length > 0) {
      return apiFunnelData.stages.map((stage) => ({
        label: tStatus(stage.name as LeadStatus),
        value: stage.cumulativeCount,
        percentage: stage.percentage,
        conversionRate: stage.conversionRate,
        ...(STAGE_COLORS[stage.name] || { color: 'bg-gray-500', bgColor: 'bg-gray-100' }),
      }));
    }

    // Fallback to leadsByStatus if API data not available
    if (!leadsByStatus) return [];

    const total = LEAD_STATUSES.reduce((sum, status) => sum + leadsByStatus[status], 0);

    if (total === 0) return [];

    // Approximate cumulative totals (lost leads cannot be placed without has_negotiated)
    const stages = [
      { key: 'new', value: total },
      { key: 'nurturing', value: total - leadsByStatus.new },
      { key: 'negotiating', value: leadsByStatus.negotiating + leadsByStatus.won },
      { key: 'won', value: leadsByStatus.won },
    ].map(({ key, value }) => ({
      label: tStatus(key as LeadStatus),
      value,
      ...STAGE_COLORS[key],
    }));

    return stages.map((stage, index) => ({
      ...stage,
      percentage: total > 0 ? (stage.value / total) * 100 : 0,
      conversionRate:
        index > 0 && stages[index - 1].value > 0
          ? (stage.value / stages[index - 1].value) * 100
          : 100,
    }));
  }, [leadsByStatus, apiFunnelData, tStatus]);

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
        <p className="text-gray-500">No data available</p>
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
                  <span className="font-semibold text-gray-900">
                    {stage.value.toLocaleString()}
                  </span>
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

      {/* Summary Stats */}
      {leadsByStatus && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-4 border-t border-gray-200">
          {LEAD_STATUSES.map((status) => (
            <div key={status} className="text-center">
              <p className={cn('text-2xl font-bold', STAGE_COLORS[status].textColor)}>
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
          <span className="text-sm font-medium text-gray-700">Overall Conversion Rate</span>
          <span className="text-2xl font-bold text-purple-600">
            {apiFunnelData
              ? apiFunnelData.overallConversionRate.toFixed(1)
              : displayData.length > 0 && leadsByStatus
                ? ((leadsByStatus.won / displayData[0].value) * 100).toFixed(1)
                : '0'}
            %
          </span>
        </div>
        {apiFunnelData && apiFunnelData.averageConversionDays > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            Average conversion time: {apiFunnelData.averageConversionDays.toFixed(1)} days
          </p>
        )}
        {(!apiFunnelData || apiFunnelData.averageConversionDays === 0) && (
          <p className="text-xs text-gray-500 mt-1">From initial lead to converted customer</p>
        )}
      </div>
    </div>
  );
}
