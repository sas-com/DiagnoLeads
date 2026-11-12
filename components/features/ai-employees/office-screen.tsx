'use client';

import { StudioPageHeader, StudioStat } from '@/components/studio';
import { Callout } from '@/components/ui/callout';
import { useOrganization } from '@/hooks/use-organization';
import { summarizeOffice } from '@/lib/features/ai-employees/office';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { trpc } from '@/lib/trpc/client';
import { Loader2, Lock } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { DeskSheet } from './desk-sheet';
import { OfficeFloor } from './office-floor';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The office is read again every minute, so a run that starts or ends shows up */
const REFRESH_MS = 60 * 1000;

/**
 * The AI office (Refs #1101, Epic #1100): the figures of the day over the floor plan, each AI
 * employee at the desk of its role, and the details of a desk in a side sheet.
 */
export function OfficeScreen() {
  const t = useTranslations('aiOffice');
  const format = useFormatter();
  const { organizationId: contextOrgId } = useOrganization();
  const organizationId = contextOrgId && UUID.test(contextOrgId) ? contextOrgId : '';
  const office = trpc.aiEmployees.office.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchInterval: REFRESH_MS }
  );
  const [openRole, setOpenRole] = useState<AiEmployeeRole | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const employees = office.data?.employees ?? [];
  const summary = summarizeOffice(employees);
  const openEmployee = employees.find((employee) => employee.role === openRole) ?? null;
  const forbidden = office.error?.data?.code === 'FORBIDDEN';

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 py-1 sm:px-2 sm:py-6">
      <StudioPageHeader
        title={t('title')}
        description={t('description')}
        actions={
          office.dataUpdatedAt > 0 && (
            <span className="text-sm text-gray-600 dark:text-gray-300">
              {t('updatedAt', {
                time: format.dateTime(new Date(office.dataUpdatedAt), {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              })}
            </span>
          )
        }
      />

      {!organizationId ? (
        <p className="text-base text-gray-700 dark:text-gray-200">{t('noOrganization')}</p>
      ) : forbidden ? (
        <Callout color="yellow" icon={Lock} title={t('forbidden')} />
      ) : office.error ? (
        <Callout color="red" title={t('loadError')} />
      ) : office.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-500" aria-hidden="true" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <SummaryStat
              label={t('summary.hired')}
              value={t('summary.people', { count: summary.hired })}
            />
            <SummaryStat
              label={t('summary.working')}
              value={t('summary.people', { count: summary.working })}
            />
            <SummaryStat
              label={t('summary.processedToday')}
              value={t('summary.items', { count: summary.processedToday })}
            />
            <SummaryStat
              label={t('summary.attention')}
              value={t('summary.people', { count: summary.attention })}
              alert={summary.attention > 0}
            />
          </div>

          <OfficeFloor
            employees={employees}
            onOpenDesk={(role) => {
              setOpenRole(role);
              setSheetOpen(true);
            }}
          />

          <DeskSheet
            organizationId={organizationId}
            role={openRole}
            employee={openEmployee}
            canManage={office.data?.canManage ?? false}
            open={sheetOpen}
            onOpenChange={setSheetOpen}
          />
        </>
      )}
    </div>
  );
}

function SummaryStat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return <StudioStat label={label} value={value} tone={alert ? 'alert' : 'default'} />;
}
