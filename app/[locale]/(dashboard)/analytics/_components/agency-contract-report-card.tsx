'use client';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Text, Title } from '@/components/ui/metric';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FUNNEL_STAGES } from '@/lib/features/agency-contracts/report';
import { trpc } from '@/lib/trpc/client';
import { useFormatter, useLocale, useTranslations } from 'next-intl';

const num = 'text-right tabular-nums';

/** Funnel and cost per sales agency contract, fixed fees included (#148) */
export function AgencyContractReportCard({ organizationId }: { organizationId: string }) {
  const t = useTranslations('settings.analytics.agencyContracts');
  const locale = useLocale();
  const format = useFormatter();
  const report = trpc.agencyContracts.report.useQuery(
    { organizationId },
    { enabled: !!organizationId, retry: false }
  );

  const yen = (value: number | null) =>
    value === null
      ? '—'
      : new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
          style: 'currency',
          currency: 'JPY',
        }).format(value);
  const day = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: 'medium' });

  // Viewers from a parent organization are not shown the report
  if (report.error?.data?.code === 'FORBIDDEN') return null;

  return (
    <Card className="p-6">
      <Title>{t('title')}</Title>
      <Text>{t('description')}</Text>
      {report.isLoading || !report.data ? (
        <div className="mt-4 h-24 animate-pulse rounded bg-gray-200" />
      ) : report.data.contracts.length === 0 && report.data.uncontracted.length === 0 ? (
        <Text className="mt-4">{report.data.canManage ? t('emptyManager') : t('empty')}</Text>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('contract')}</TableHead>
                {FUNNEL_STAGES.map((stage) => (
                  <TableHead key={stage} className="text-right">
                    {t(`stages.${stage}`)}
                  </TableHead>
                ))}
                <TableHead className="text-right">{t('totalCost')}</TableHead>
                <TableHead className="text-right">{t('costPerAppointment')}</TableHead>
                <TableHead className="text-right">{t('costPerSql')}</TableHead>
                <TableHead className="text-right">{t('costPerPhase1Won')}</TableHead>
                <TableHead className="text-right">{t('plan')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.data.contracts.map((row) => (
                <TableRow key={row.contract.id}>
                  <TableCell className="whitespace-nowrap">
                    <div className="font-medium">{row.contract.agencyName}</div>
                    <div className="text-xs text-gray-500">
                      {t('term', {
                        start: day(row.contract.startsOn),
                        end: row.contract.endsOn ? day(row.contract.endsOn) : t('ongoing'),
                      })}
                    </div>
                  </TableCell>
                  {FUNNEL_STAGES.map((stage) => (
                    <TableCell key={stage} className={num}>
                      {row.funnel[stage]}
                    </TableCell>
                  ))}
                  <TableCell className={num}>
                    {yen(row.totalCost)}
                    <span className="block text-xs text-gray-500">
                      {t('costBreakdown', {
                        fixed: yen(row.fixedCost),
                        appointments: yen(row.appointmentCost),
                      })}
                    </span>
                  </TableCell>
                  <TableCell className={num}>{yen(row.costPer.appointments)}</TableCell>
                  <TableCell className={num}>{yen(row.costPer.sqls)}</TableCell>
                  <TableCell className={num}>{yen(row.costPer.phase1Won)}</TableCell>
                  <TableCell className={`${num} whitespace-nowrap text-xs`}>
                    {row.plan.appointments !== null && (
                      <div>
                        {t('planAppointments', {
                          actual: row.funnel.appointments,
                          plan: row.plan.appointments,
                          rate: row.plan.appointmentsRate ?? 0,
                        })}
                      </div>
                    )}
                    {row.plan.costPerAppointment !== null && (
                      <div
                        className={
                          (row.plan.costPerAppointmentDiff ?? 0) > 0
                            ? 'text-red-600'
                            : 'text-emerald-700'
                        }
                      >
                        {t('planCost', { plan: yen(row.plan.costPerAppointment) })}
                      </div>
                    )}
                    {row.plan.appointments === null && row.plan.costPerAppointment === null && '—'}
                  </TableCell>
                </TableRow>
              ))}
              {report.data.uncontracted.map((row) => (
                <TableRow key={`none-${row.agencyName}`}>
                  <TableCell className="whitespace-nowrap">
                    <div className="font-medium">{row.agencyName}</div>
                    <Badge color="yellow">{t('noContract')}</Badge>
                  </TableCell>
                  {FUNNEL_STAGES.map((stage) => (
                    <TableCell key={stage} className={num}>
                      {row.funnel[stage]}
                    </TableCell>
                  ))}
                  <TableCell className={`${num} text-gray-500`} colSpan={5}>
                    {t('costNotRegistered')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
