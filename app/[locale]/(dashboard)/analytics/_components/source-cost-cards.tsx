'use client';

import { Card } from '@/components/ui/card';
import { Text, Title } from '@/components/ui/metric';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  AcquisitionCostSummary,
  AgencyPerformanceRow,
  DealReturns,
} from '@/lib/features/analytics/types/schemas';
import { useLocale, useTranslations } from 'next-intl';

const yen = (locale: string, value: number | null) =>
  value === null
    ? '—'
    : new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
        style: 'currency',
        currency: 'JPY',
      }).format(value);

function TableSkeleton() {
  return (
    <div className="space-y-3 mt-4">
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-8 bg-gray-200 animate-pulse rounded" />
      ))}
    </div>
  );
}

const num = 'text-right tabular-nums';

/**
 * What the deals of the leads brought in, per row and in total (#448). Shown only to those who
 * may read deals: the rows then carry `deals`.
 */
function DealReturnsTable({
  rows,
  total,
}: {
  rows: { key: string; label: string; deals: DealReturns }[];
  total?: DealReturns;
}) {
  const t = useTranslations('settings.analytics.returns');
  const locale = useLocale();
  const roi = (value: number | null) => (value === null ? '—' : t('roiValue', { value }));
  const days = (value: number | null) => (value === null ? '—' : t('daysValue', { days: value }));
  const cells = (deals: DealReturns) => (
    <>
      <TableCell className={num}>{deals.dealCount}</TableCell>
      <TableCell className={num}>{deals.wonDealCount}</TableCell>
      <TableCell className={num}>{yen(locale, deals.wonAmount)}</TableCell>
      <TableCell className={num}>{yen(locale, deals.costPerWonDeal)}</TableCell>
      <TableCell className={num}>{roi(deals.roi)}</TableCell>
      <TableCell className={num}>{days(deals.medianDaysToWin)}</TableCell>
    </>
  );

  return (
    <div className="mt-6" data-testid="deal-returns">
      <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('title')}</h4>
      <Text>{t('description')}</Text>
      <div className="mt-2 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('row')}</TableHead>
              <TableHead className="text-right">{t('deals')}</TableHead>
              <TableHead className="text-right">{t('wonDeals')}</TableHead>
              <TableHead className="text-right">{t('wonAmount')}</TableHead>
              <TableHead className="text-right">{t('costPerWonDeal')}</TableHead>
              <TableHead className="text-right">{t('roi')}</TableHead>
              <TableHead className="text-right">{t('medianDays')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="whitespace-nowrap">{row.label}</TableCell>
                {cells(row.deals)}
              </TableRow>
            ))}
          </TableBody>
          {total && (
            <TableFooter>
              <TableRow>
                <TableCell>{t('total')}</TableCell>
                {cells(total)}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
}

/** Rows that carry their deals (all of them, or none for those who may not read deals) */
function withDeals<T extends { deals: DealReturns | null }>(rows: T[]) {
  return rows.filter((row): row is T & { deals: DealReturns } => row.deals != null);
}

/** Acquisition cost by 流入元, from the cost recorded on each lead */
export function AcquisitionCostCard({
  data,
  isLoading,
  sourceLabel,
}: {
  data: AcquisitionCostSummary | undefined;
  isLoading: boolean;
  sourceLabel: (source: string) => string;
}) {
  const t = useTranslations('settings.analytics');
  const locale = useLocale();

  return (
    <Card className="p-6">
      <Title>{t('acquisitionCost.title')}</Title>
      <Text>{t('acquisitionCost.description')}</Text>
      {isLoading ? (
        <TableSkeleton />
      ) : !data || data.leadCount === 0 ? (
        <Text className="mt-4">{t('noData')}</Text>
      ) : (
        <>
          {data.costedLeadCount === 0 && (
            <Text className="mt-4">{t('acquisitionCost.noCost')}</Text>
          )}
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('acquisitionCost.source')}</TableHead>
                  <TableHead className="text-right">{t('acquisitionCost.leads')}</TableHead>
                  <TableHead className="text-right">{t('acquisitionCost.sql')}</TableHead>
                  <TableHead className="text-right">{t('acquisitionCost.won')}</TableHead>
                  <TableHead className="text-right">{t('acquisitionCost.totalCost')}</TableHead>
                  <TableHead className="text-right">{t('acquisitionCost.costPerSql')}</TableHead>
                  <TableHead className="text-right">{t('acquisitionCost.costPerWon')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.bySource.map((row) => (
                  <TableRow key={row.source}>
                    <TableCell className="whitespace-nowrap">
                      {sourceLabel(row.source)}
                      {row.costedLeadCount < row.leadCount && (
                        <span className="block text-xs text-gray-500">
                          {t('acquisitionCost.uncosted', {
                            count: row.leadCount - row.costedLeadCount,
                          })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className={num}>{row.leadCount}</TableCell>
                    <TableCell className={num}>{row.sqlCount}</TableCell>
                    <TableCell className={num}>{row.wonCount}</TableCell>
                    <TableCell className={num}>{yen(locale, row.totalCost)}</TableCell>
                    <TableCell className={num}>{yen(locale, row.costPerSql)}</TableCell>
                    <TableCell className={num}>{yen(locale, row.costPerWon)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>{t('acquisitionCost.total')}</TableCell>
                  <TableCell className={num}>{data.leadCount}</TableCell>
                  <TableCell className={num}>{data.sqlCount}</TableCell>
                  <TableCell className={num}>{data.wonCount}</TableCell>
                  <TableCell className={num}>{yen(locale, data.totalCost)}</TableCell>
                  <TableCell className={num}>{yen(locale, data.costPerSql)}</TableCell>
                  <TableCell className={num}>{yen(locale, data.costPerWon)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          {data.deals && data.deals.dealCount > 0 && (
            <DealReturnsTable
              rows={withDeals(data.bySource).map((row) => ({
                key: row.source,
                label: sourceLabel(row.source),
                deals: row.deals,
              }))}
              total={data.deals}
            />
          )}
        </>
      )}
    </Card>
  );
}

/** Leads, SQL and cost per sales agency */
export function AgencyPerformanceCard({
  data,
  isLoading,
}: {
  data: AgencyPerformanceRow[] | undefined;
  isLoading: boolean;
}) {
  const t = useTranslations('settings.analytics');
  const locale = useLocale();

  return (
    <Card className="p-6">
      <Title>{t('agency.title')}</Title>
      <Text>{t('agency.description')}</Text>
      {isLoading ? (
        <TableSkeleton />
      ) : !data || data.length === 0 ? (
        <Text className="mt-4">{t('agency.empty')}</Text>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('agency.agencyName')}</TableHead>
                <TableHead className="text-right">{t('agency.leads')}</TableHead>
                <TableHead className="text-right">{t('agency.sql')}</TableHead>
                <TableHead className="text-right">{t('agency.sqlRate')}</TableHead>
                <TableHead className="text-right">{t('agency.won')}</TableHead>
                <TableHead className="text-right">{t('agency.totalCost')}</TableHead>
                <TableHead className="text-right">{t('agency.costPerSql')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.agencyName}>
                  <TableCell className="whitespace-nowrap">
                    {row.agencyName}
                    {row.costedLeadCount < row.leadCount && (
                      <span className="block text-xs text-gray-500">
                        {t('acquisitionCost.uncosted', {
                          count: row.leadCount - row.costedLeadCount,
                        })}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className={num}>{row.leadCount}</TableCell>
                  <TableCell className={num}>{row.sqlCount}</TableCell>
                  <TableCell className={num}>{row.sqlRate.toFixed(1)}%</TableCell>
                  <TableCell className={num}>{row.wonCount}</TableCell>
                  <TableCell className={num}>{yen(locale, row.totalCost)}</TableCell>
                  <TableCell className={num}>{yen(locale, row.costPerSql)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {withDeals(data).some((row) => row.deals.dealCount > 0) && (
            <DealReturnsTable
              rows={withDeals(data).map((row) => ({
                key: row.agencyName,
                label: row.agencyName,
                deals: row.deals,
              }))}
            />
          )}
        </div>
      )}
    </Card>
  );
}
