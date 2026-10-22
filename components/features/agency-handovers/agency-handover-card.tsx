'use client';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { trpc } from '@/lib/trpc/client';
import { Headset } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

/**
 * What the sales agency heard when it set up the meeting (Refs #152), from its imported report.
 * The model, support end, retirement and decision maker also prefill a new hearing (代行聴取).
 * Hidden when the lead has none.
 */
export function AgencyHandoverCard({
  organizationId,
  leadId,
}: { organizationId: string; leadId: string }) {
  const t = useTranslations('agencyHandovers.card');
  const tColumn = useTranslations('agencyHandovers.columns');
  const format = useFormatter();
  const query = trpc.agencyHandovers.get.useQuery(
    { organizationId, leadId },
    { enabled: !!organizationId, retry: false }
  );
  const handover = query.data?.handover;
  if (query.isError || !handover) return null;

  const rows: [string, string | null][] = [
    [tColumn('agencyName'), handover.agencyName],
    [
      tColumn('appointmentOn'),
      handover.appointmentOn
        ? format.dateTime(new Date(`${handover.appointmentOn}T00:00:00Z`), {
            dateStyle: 'medium',
            timeZone: 'UTC',
          })
        : null,
    ],
    [
      tColumn('contactName'),
      [handover.contactName, handover.contactTitle].filter(Boolean).join(' / ') || null,
    ],
    [tColumn('contactPhone'), handover.contactPhone],
    [
      tColumn('machineModel'),
      handover.machineModel
        ? `${handover.machineModel}${
            handover.machineModelConfirmed === null
              ? ''
              : `（${handover.machineModelConfirmed ? t('confirmed') : t('notConfirmed')}）`
          }`
        : null,
    ],
    [tColumn('hardwareSupportEnd'), handover.hardwareSupportEnd],
    [tColumn('retirementPlan'), handover.retirementPlan],
    [
      tColumn('decisionMakerPresent'),
      handover.decisionMakerPresent ? t(`decisionMaker.${handover.decisionMakerPresent}`) : null,
    ],
    [tColumn('refusalReason'), handover.refusalReason],
    [tColumn('note'), handover.note],
  ];

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Headset className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        {handover.interestLevel && (
          <Badge color={handover.interestLevel === 'high' ? 'emerald' : 'gray'}>
            {t('interest', { level: t(`interestLevels.${handover.interestLevel}`) })}
          </Badge>
        )}
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="whitespace-pre-wrap break-words text-foreground">{value}</dd>
            </div>
          ))}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        {t('footer', {
          name: handover.importedByName ?? '—',
          date: format.dateTime(new Date(handover.updatedAt), { dateStyle: 'medium' }),
        })}
      </p>
    </Card>
  );
}
