'use client';

import { Card } from '@/components/ui/card';
import { Metric, Text, Title } from '@/components/ui/metric';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DELIVERY_PHASES, type EffortDeviation } from '@/lib/features/delivery-reviews/report';
import { DIFFICULTY_LEVELS } from '@/lib/features/delivery-reviews/types/schemas';
import { AX_CHECKPOINT_KEYS } from '@/lib/features/diagnostics/ax-migration/evaluate';
import { trpc } from '@/lib/trpc/client';
import { useTranslations } from 'next-intl';

const num = 'text-right tabular-nums';

/**
 * Phase 1 → 2 → 3 of the phased delivery, and the diagnosis checkpoints, difficulty and effort
 * next to the delivery reviews (#159)
 */
export function DeliveryReportCards({ organizationId }: { organizationId: string }) {
  const t = useTranslations('deliveryReviews');
  const tPhase = useTranslations('pipeline.dealPhase');
  const report = trpc.deliveryReviews.report.useQuery(
    { organizationId },
    { enabled: !!organizationId, retry: false }
  );

  if (report.isError) return null;
  if (report.isLoading || !report.data) {
    return <div className="mt-6 h-24 animate-pulse rounded bg-gray-200" />;
  }
  const { progress, accuracy } = report.data;
  const checkpointLabel = (key: string) =>
    (AX_CHECKPOINT_KEYS as readonly string[]).includes(key) ? t(`checkpoints.${key}`) : key;
  const effortText = (effort: EffortDeviation) =>
    effort.count === 0 || effort.meanPercent === null
      ? t('report.noEffort')
      : t('report.effortValue', {
          count: effort.count,
          mean: effort.meanPercent > 0 ? `+${effort.meanPercent}` : String(effort.meanPercent),
          over: effort.over,
        });

  return (
    <div className="mt-6 space-y-6">
      <Card className="p-6">
        <Title>{t('report.progressTitle')}</Title>
        <Text>{t('report.progressDescription')}</Text>
        {progress.reached.survey_won + progress.reached.migration_won + progress.reached.ax ===
        0 ? (
          <Text className="mt-4">{t('report.noProgress')}</Text>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {DELIVERY_PHASES.map((phase) => (
                <div key={phase} className="rounded-md border p-4">
                  <Text>{tPhase(phase)}</Text>
                  <Metric className="mt-1">{progress.reached[phase]}</Metric>
                  <Text className="text-xs">{t('report.reached')}</Text>
                </div>
              ))}
            </div>
            <div className="mt-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead />
                    <TableHead className="text-right">{t('report.started')}</TableHead>
                    <TableHead className="text-right">{t('report.advanced')}</TableHead>
                    <TableHead className="text-right">{t('report.rate')}</TableHead>
                    <TableHead className="text-right">{t('report.medianDays')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {progress.steps.map((step) => (
                    <TableRow key={`${step.from}-${step.to}`}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {t('report.step', { from: tPhase(step.from), to: tPhase(step.to) })}
                      </TableCell>
                      <TableCell className={num}>{step.started}</TableCell>
                      <TableCell className={num}>{step.advanced}</TableCell>
                      <TableCell className={num}>
                        {step.rate === null ? '—' : `${step.rate}%`}
                      </TableCell>
                      <TableCell className={num}>
                        {step.medianDays === null
                          ? '—'
                          : t('report.days', { days: step.medianDays })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Card>

      <Card className="p-6">
        <Title>{t('report.accuracyTitle')}</Title>
        <Text>{t('report.accuracyDescription')}</Text>
        {accuracy.reviewed === 0 ? (
          <Text className="mt-4">{t('report.noReviews')}</Text>
        ) : (
          <div className="mt-4 space-y-6">
            <Text>
              {t('report.reviewed', {
                reviewed: accuracy.reviewed,
                withDiagnosis: accuracy.withDiagnosis,
              })}
            </Text>

            {accuracy.checkpoints.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('report.checkpoint')}</TableHead>
                      <TableHead className="text-right">{t('report.flagged')}</TableHead>
                      <TableHead className="text-right">{t('outcomes.hard')}</TableHead>
                      <TableHead className="text-right">{t('outcomes.as_expected')}</TableHead>
                      <TableHead className="text-right">{t('outcomes.not_relevant')}</TableHead>
                      <TableHead className="text-right">{t('report.missed')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accuracy.checkpoints.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell>{checkpointLabel(row.key)}</TableCell>
                        <TableCell className={num}>{row.flagged}</TableCell>
                        <TableCell className={num}>{row.outcomes.hard}</TableCell>
                        <TableCell className={num}>{row.outcomes.as_expected}</TableCell>
                        <TableCell className={num}>{row.outcomes.not_relevant}</TableCell>
                        <TableCell className={num}>{row.missed}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-medium text-foreground">
                  {t('report.difficultyTitle')}
                </h3>
                {accuracy.difficultyMatchRate !== null && (
                  <Text className="text-xs">
                    {t('report.matchRate', { rate: accuracy.difficultyMatchRate })}
                  </Text>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">
                        {t('report.difficultyHeader')}
                      </TableHead>
                      {DIFFICULTY_LEVELS.map((level) => (
                        <TableHead key={level} className="text-right">
                          {t(`levels.${level}`)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {DIFFICULTY_LEVELS.map((predicted) => (
                      <TableRow key={predicted}>
                        <TableCell>{t(`levels.${predicted}`)}</TableCell>
                        {DIFFICULTY_LEVELS.map((actual) => (
                          <TableCell
                            key={actual}
                            className={`${num} ${predicted === actual ? 'font-semibold' : ''}`}
                          >
                            {accuracy.difficulty[predicted][actual]}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div>
                <h3 className="text-sm font-medium text-foreground">{t('report.effortTitle')}</h3>
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-muted-foreground">{t('report.effortAll')}</dt>
                    <dd className="tabular-nums">{effortText(accuracy.effort)}</dd>
                  </div>
                  {DIFFICULTY_LEVELS.map((level) => (
                    <div key={level} className="flex flex-wrap justify-between gap-2">
                      <dt className="text-muted-foreground">
                        {t('report.effortByLevel', { level: t(`levels.${level}`) })}
                      </dt>
                      <dd className="tabular-nums">
                        {effortText(accuracy.effortByDifficulty[level])}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
