'use client';

import { StudioPageHeader, StudioStat } from '@/components/studio';
import { Callout } from '@/components/ui/callout';
import { useOrganization } from '@/hooks/use-organization';
import { summarizeOffice } from '@/lib/features/ai-employees/office';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { trpc } from '@/lib/trpc/client';
import { Loader2, Lock } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import { DeskSheet, OFFICE_REFRESH_MS } from './desk-sheet';
import { OfficeMap } from './office-map';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The AI office (Refs #1101, Epic #1100): the figures of the day over a virtual office, the whole
 * floor seen from above with each AI employee as a robot where its status takes it, and the
 * details of a desk in a side sheet. The page is wider than STUDIO_PAGE_CLASS so the floor map
 * stays readable.
 */
export function OfficeScreen() {
  const t = useTranslations('aiOffice');
  const format = useFormatter();
  const summaryHeadingId = useId();
  const { organizationId: contextOrgId } = useOrganization();
  const organizationId = contextOrgId && UUID.test(contextOrgId) ? contextOrgId : '';
  const office = trpc.aiEmployees.office.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchInterval: OFFICE_REFRESH_MS }
  );
  const [openRole, setOpenRole] = useState<AiEmployeeRole | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const deskRef = useRef<HTMLElement | null>(null);

  const employees = office.data?.employees ?? [];
  const canManage = office.data?.canManage ?? false;
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
        <output className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-500" aria-hidden="true" />
          <span className="sr-only">{t('loading')}</span>
        </output>
      ) : (
        <>
          <section aria-labelledby={summaryHeadingId}>
            <h2 id={summaryHeadingId} className="sr-only">
              {t('summary.heading')}
            </h2>
            {/* What needs a look first, then the day's work */}
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <StudioStat
                label={t('summary.attention')}
                value={t('summary.people', { count: summary.attention })}
                tone={summary.attention > 0 ? 'alert' : 'default'}
              />
              <StudioStat
                label={t('summary.working')}
                value={t('summary.people', { count: summary.working })}
              />
              <StudioStat
                label={t('summary.processedToday')}
                value={t('summary.items', { count: summary.processedToday })}
              />
              <StudioStat
                label={t('summary.hired')}
                value={t('summary.people', { count: summary.hired })}
              />
            </div>
          </section>

          <OfficeMap
            employees={employees}
            canManage={canManage}
            onOpenDesk={(role, desk) => {
              deskRef.current = desk;
              setOpenRole(role);
              setSheetOpen(true);
            }}
          />

          <DeskSheet
            organizationId={organizationId}
            role={openRole}
            employee={openEmployee}
            canManage={canManage}
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            returnFocusTo={deskRef}
          />
        </>
      )}
    </div>
  );
}
