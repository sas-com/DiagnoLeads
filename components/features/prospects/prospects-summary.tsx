'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CALL_RESULTS, REFUSAL_REASONS } from '@/lib/features/prospects/types/schemas';
import { PROSPECT_STAGES } from '@/lib/features/prospects/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ProspectSummaryData } from './types';

const percent = (value: number | null) => (value === null ? '' : `${Math.round(value * 100)}%`);

/** The summary for management, as in the spreadsheet's summary sheet (#265) */
export function ProspectsSummary({ organizationId }: { organizationId: string }) {
  const t = useTranslations('prospects');
  const query = trpc.prospects.summary.useQuery({ organizationId }, { retry: false });

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }
  if (query.error || !query.data) {
    return (
      <p className="py-8 text-center text-muted-foreground">
        {query.error?.data?.code === 'FORBIDDEN' ? t('forbidden') : t('loadError')}
      </p>
    );
  }

  const { summary, isSales } = query.data;
  const { overall, checks } = summary;
  const monthLabel = (month: string) =>
    t('summary.monthFormat', { year: month.slice(0, 4), month: Number(month.slice(5, 7)) });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title={t('summary.overall')}>
        <CountTable
          head={[t('summary.item'), t('summary.count')]}
          rows={[
            [t('summary.total'), overall.total],
            [t('summary.hasIssue'), overall.hasIssue],
            [t('summary.handOver'), overall.handOver],
            [t('summary.keepChecking'), overall.keepChecking],
            [t('summary.meetings'), overall.meetings],
            [t('summary.contracts'), overall.contracts],
            [t('summary.nurturing'), overall.nurturing],
            [t('summary.passed'), overall.passed],
          ]}
        />
      </Section>

      <Section title={t('summary.checks')}>
        <CountTable
          head={[t('summary.item'), t('summary.count')]}
          rows={[
            [t('summary.stageWithoutNextAction'), checks.stageWithoutNextAction],
            [t('summary.overdue'), checks.overdue],
            [t('summary.handOverWithoutStage'), checks.handOverWithoutStage],
          ]}
          highlight
        />
      </Section>

      {summary.calls.total > 0 && (
        <Section title={t('summary.calls')}>
          <CountTable
            head={[t('summary.item'), t('summary.count')]}
            rows={[
              ...CALL_RESULTS.map((result): [string, number] => [
                t(`callResult.${result}`),
                summary.calls.byResult[result],
              ]),
              ...REFUSAL_REASONS.map((reason): [string, number] => [
                t('summary.refusedFor', { reason: t(`refusalReason.${reason}`) }),
                summary.calls.refusals[reason],
              ]),
            ]}
          />
        </Section>
      )}

      <Section title={t('summary.stages')} wide>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('summary.stage')}</TableHead>
                <TableHead className="text-right">{t('summary.current')}</TableHead>
                <TableHead className="text-right">{t('summary.share')}</TableHead>
                <TableHead className="text-right">{t('summary.reached')}</TableHead>
                <TableHead className="text-right">{t('summary.progressRate')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.stages.map((row) => (
                <TableRow key={row.stage}>
                  <TableCell>{t(`stage.${row.stage}`)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.current}</TableCell>
                  <TableCell className="text-right tabular-nums">{percent(row.share)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.reached ?? ''}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {percent(row.progressRate)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-medium">
                <TableCell>{t('summary.withStage')}</TableCell>
                <TableCell className="text-right tabular-nums">{summary.withStage}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {summary.withStage > 0 ? '100%' : '0%'}
                </TableCell>
                <TableCell />
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title={t('summary.entries')} wide>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('summary.entry')}</TableHead>
                <TableHead className="text-right">{t('summary.recorded')}</TableHead>
                <TableHead className="text-right">{t('reaction.has_issue')}</TableHead>
                <TableHead className="text-right">{t('nextStep.hand_over')}</TableHead>
                <TableHead className="text-right">{t('summary.monthMeetings')}</TableHead>
                <TableHead className="text-right">{t('stage.contract')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.entries.map((row) => (
                <TableRow key={row.entry}>
                  <TableCell className="whitespace-nowrap">{t(`entry.${row.entry}`)}</TableCell>
                  {[row.total, row.hasIssue, row.handOver, row.meetings, row.contracts].map(
                    (value, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: fixed columns
                      <TableCell key={index} className="text-right tabular-nums">
                        {value}
                      </TableCell>
                    )
                  )}
                </TableRow>
              ))}
              <TableRow className="font-medium">
                <TableCell>{t('summary.sum')}</TableCell>
                {(['total', 'hasIssue', 'handOver', 'meetings', 'contracts'] as const).map(
                  (key) => (
                    <TableCell key={key} className="text-right tabular-nums">
                      {summary.entries.reduce((sum, row) => sum + row[key], 0)}
                    </TableCell>
                  )
                )}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title={t('summary.entryStage')} wide>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('summary.entry')}</TableHead>
                {PROSPECT_STAGES.map((stage) => (
                  <TableHead key={stage} className="whitespace-nowrap text-right">
                    {t(`stage.${stage}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.entries.map((row) => (
                <TableRow key={row.entry}>
                  <TableCell className="whitespace-nowrap">{t(`entry.${row.entry}`)}</TableCell>
                  {PROSPECT_STAGES.map((stage) => (
                    <TableCell key={stage} className="text-right tabular-nums">
                      {row.byStage[stage]}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title={t('summary.months')} wide>
        <MonthsTable
          organizationId={organizationId}
          months={summary.months}
          targets={query.data.targets}
          isSales={isSales}
          monthLabel={monthLabel}
        />
      </Section>
    </div>
  );
}

function Section({
  title,
  wide = false,
  children,
}: {
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className={wide ? 'lg:col-span-2' : undefined}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function CountTable({
  head,
  rows,
  highlight = false,
}: {
  head: [string, string];
  rows: [string, number][];
  /** Counts above zero need attention */
  highlight?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{head[0]}</TableHead>
          <TableHead className="text-right">{head[1]}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([label, value]) => (
          <TableRow key={label}>
            <TableCell>{label}</TableCell>
            <TableCell
              className={`text-right tabular-nums ${highlight && value > 0 ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}
            >
              {value}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MonthsTable({
  organizationId,
  months,
  targets,
  isSales,
  monthLabel,
}: {
  organizationId: string;
  months: ProspectSummaryData['summary']['months'];
  targets: ProspectSummaryData['targets'];
  isSales: boolean;
  monthLabel: (month: string) => string;
}) {
  const t = useTranslations('prospects.summary');
  const tProspects = useTranslations('prospects');
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const save = trpc.prospects.setMeetingTargets.useMutation({
    onSuccess: () => {
      toast.success(t('targetsSaved'));
      utils.prospects.summary.invalidate();
      setDraft(null);
    },
    onError: () => toast.error(tProspects('saveError')),
  });

  // While editing, offer the shown months plus the next three, to set targets ahead
  const editableMonths = [...months.map((row) => row.month)];
  if (draft) {
    let last = editableMonths[editableMonths.length - 1];
    for (let i = 0; i < 3 && last; i++) {
      const [year, month] = last.split('-').map(Number) as [number, number];
      last =
        month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
      if (!editableMonths.includes(last)) editableMonths.push(last);
    }
  }

  const startEditing = () =>
    setDraft(Object.fromEntries(targets.map((target) => [target.month, String(target.meetings)])));

  const submit = () => {
    if (!draft) return;
    const next = Object.entries(draft)
      .filter(([, value]) => value.trim() !== '')
      .map(([month, value]) => ({ month, meetings: Math.max(0, Math.floor(Number(value))) }))
      .filter((target) => Number.isFinite(target.meetings));
    save.mutate({ organizationId, targets: next });
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('month')}</TableHead>
              <TableHead className="text-right">{t('recorded')}</TableHead>
              <TableHead className="text-right">{t('monthMeetings')}</TableHead>
              <TableHead className="text-right">{t('meetingsToDate')}</TableHead>
              <TableHead className="text-right">{t('target')}</TableHead>
              <TableHead className="text-right">{t('gap')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(draft ? editableMonths : months.map((row) => row.month)).map((month) => {
              const row = months.find((item) => item.month === month);
              return (
                <TableRow key={month}>
                  <TableCell className="whitespace-nowrap">{monthLabel(month)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row?.recorded ?? ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{row?.meetings ?? ''}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row?.meetingsToDate ?? ''}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {draft ? (
                      <Input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        className="ml-auto h-8 w-20 text-right"
                        aria-label={`${t('target')} ${monthLabel(month)}`}
                        value={draft[month] ?? ''}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, [month]: event.target.value }))
                        }
                      />
                    ) : (
                      (row?.target ?? '')
                    )}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${row?.gap !== null && row?.gap !== undefined && row.gap < 0 ? 'text-red-600 dark:text-red-400' : ''}`}
                  >
                    {row?.gap ?? ''}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {isSales && (
        <div className="flex flex-wrap items-center gap-2">
          {draft ? (
            <>
              <Button type="button" onClick={submit} disabled={save.isPending}>
                {save.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                {t('saveTargets')}
              </Button>
              <p className="text-xs text-muted-foreground">{t('targetsHint')}</p>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={startEditing}>
              {t('editTargets')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
