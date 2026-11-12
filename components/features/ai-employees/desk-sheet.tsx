'use client';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { OfficeEmployee } from '@/lib/features/ai-employees/service';
import {
  AI_EMPLOYEE_ROLE_DEFINITIONS,
  type AiEmployeeRole,
} from '@/lib/features/ai-employees/types/roles';
import { AI_EMPLOYEE_NAME_MAX_LENGTH } from '@/lib/features/ai-employees/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, type RefObject, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DeskStatusLabel } from './desk-status';
import { RobotAvatar } from './office-illustration';

/** The work log is read again as often as the office, so both tell the same story */
export const OFFICE_REFRESH_MS = 60 * 1000;

const STATUS_CALLOUT: Record<DeskStatus, 'blue' | 'yellow' | 'red' | 'green'> = {
  working: 'green',
  attention: 'red',
  idle: 'blue',
  training: 'blue',
  paused: 'yellow',
  vacant: 'blue',
};

/**
 * The details of one desk (Refs #1101), in reading order: the robot with its name and status,
 * what the status means, what the role does, the work log, then for admins the actions (hire on
 * a vacant desk; rename, pause or resume; and apart, dismiss). The focus goes to the title when
 * the sheet opens, and back to the desk that opened it when it closes.
 */
export function DeskSheet({
  organizationId,
  role,
  employee,
  canManage,
  open,
  onOpenChange,
  returnFocusTo,
}: {
  organizationId: string;
  role: AiEmployeeRole | null;
  employee: OfficeEmployee | null;
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The desk button that opened the sheet */
  returnFocusTo: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations('aiOffice');
  const format = useFormatter();
  const titleRef = useRef<HTMLHeadingElement>(null);
  if (!role) return null;
  const status: DeskStatus = employee?.deskStatus ?? 'vacant';
  const roleTitle = t(`roles.${role}.title`);
  const focusTitle = () => titleRef.current?.focus();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full overflow-y-auto sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusTitle();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo.current?.focus();
        }}
      >
        <SheetHeader className="space-y-2 pr-8 text-left">
          <div className="flex items-center gap-3">
            <RobotAvatar status={status} />
            <div className="min-w-0">
              <SheetTitle ref={titleRef} tabIndex={-1} className="break-words text-xl font-bold">
                {employee ? employee.name : t('sheet.vacantTitle', { role: roleTitle })}
              </SheetTitle>
              <DeskStatusLabel status={status} className="mt-1" />
            </div>
          </div>
          <SheetDescription className="text-base text-gray-700 dark:text-gray-200">
            {t(`roles.${role}.description`)}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-8">
          <Callout color={STATUS_CALLOUT[status]} title={t(`statusHint.${status}`)} />

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
            <dt className="text-gray-600 dark:text-gray-300">{t('sheet.role')}</dt>
            <dd className="text-gray-900 dark:text-gray-50">{roleTitle}</dd>
            <dt className="text-gray-600 dark:text-gray-300">{t('sheet.room')}</dt>
            <dd className="text-gray-900 dark:text-gray-50">
              {t(`rooms.${AI_EMPLOYEE_ROLE_DEFINITIONS[role].room}`)}
            </dd>
            {employee && (
              <>
                <dt className="text-gray-600 dark:text-gray-300">{t('sheet.hiredAt')}</dt>
                <dd className="text-gray-900 dark:text-gray-50">
                  {format.dateTime(new Date(employee.createdAt), { dateStyle: 'medium' })}
                </dd>
              </>
            )}
          </dl>

          {!employee && canManage && (
            <HireForm organizationId={organizationId} role={role} onHired={focusTitle} />
          )}

          {employee && <RunLog organizationId={organizationId} employeeId={employee.id} />}

          {employee && canManage && (
            <ManageSection
              organizationId={organizationId}
              employee={employee}
              onDismissed={() => onOpenChange(false)}
            />
          )}

          {!canManage && (
            <p className="text-base text-gray-700 dark:text-gray-200">{t('sheet.readOnly')}</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function HireForm({
  organizationId,
  role,
  onHired,
}: {
  organizationId: string;
  role: AiEmployeeRole;
  onHired: () => void;
}) {
  const t = useTranslations('aiOffice');
  const utils = trpc.useUtils();
  const inputId = useId();
  const [name, setName] = useState(() => t(`roles.${role}.defaultName`));
  const hire = trpc.aiEmployees.hire.useMutation({
    onSuccess: async () => {
      toast.success(t('toast.hired', { name: name.trim() }));
      await utils.aiEmployees.office.invalidate({ organizationId });
      // The form goes away with the button that had the focus
      onHired();
    },
    onError: (error) =>
      toast.error(error.data?.code === 'CONFLICT' ? t('toast.conflict') : t('toast.error')),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    hire.mutate({ organizationId, role, name: name.trim() });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={inputId}>{t('sheet.name')}</Label>
        <Input
          id={inputId}
          className="min-h-11"
          value={name}
          maxLength={AI_EMPLOYEE_NAME_MAX_LENGTH}
          required
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <Button type="submit" className="min-h-11" disabled={hire.isPending || !name.trim()}>
        {hire.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {t('sheet.hireSubmit')}
      </Button>
    </form>
  );
}

function ManageSection({
  organizationId,
  employee,
  onDismissed,
}: {
  organizationId: string;
  employee: OfficeEmployee;
  onDismissed: () => void;
}) {
  const t = useTranslations('aiOffice');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();
  const inputId = useId();
  const [name, setName] = useState(employee.name);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => setName(employee.name), [employee.name]);

  const refresh = async () => {
    await utils.aiEmployees.office.invalidate({ organizationId });
    await utils.aiEmployees.runs.invalidate({ organizationId });
  };
  const update = trpc.aiEmployees.update.useMutation({
    onSuccess: async (updated, variables) => {
      if (variables.status === 'paused') toast.success(t('toast.paused', { name: updated.name }));
      else if (variables.status === 'active') {
        toast.success(t('toast.resumed', { name: updated.name }));
      } else toast.success(t('toast.renamed', { name: updated.name }));
      await refresh();
    },
    onError: () => toast.error(t('toast.actionError')),
  });
  const dismiss = trpc.aiEmployees.dismiss.useMutation({
    onSuccess: async () => {
      toast.success(t('toast.dismissed', { name: employee.name }));
      setConfirmOpen(false);
      onDismissed();
      await refresh();
    },
    onError: () => toast.error(t('toast.actionError')),
  });

  const rename = (event: FormEvent) => {
    event.preventDefault();
    const next = name.trim();
    if (!next || next === employee.name) return;
    update.mutate({ organizationId, employeeId: employee.id, name: next });
  };
  const paused = employee.status === 'paused';

  return (
    <>
      <section className="space-y-4" aria-labelledby={`${inputId}-manage`}>
        <h3 id={`${inputId}-manage`} className="text-lg font-bold text-gray-900 dark:text-gray-50">
          {t('sheet.manage')}
        </h3>
        <form onSubmit={rename} className="space-y-1.5">
          <Label htmlFor={inputId}>{t('sheet.name')}</Label>
          <div className="flex gap-2">
            <Input
              id={inputId}
              className="min-h-11"
              value={name}
              maxLength={AI_EMPLOYEE_NAME_MAX_LENGTH}
              required
              onChange={(event) => setName(event.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              className="min-h-11 shrink-0"
              disabled={update.isPending || !name.trim() || name.trim() === employee.name}
            >
              {t('sheet.rename')}
            </Button>
          </div>
        </form>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={update.isPending}
          onClick={() =>
            update.mutate({
              organizationId,
              employeeId: employee.id,
              status: paused ? 'active' : 'paused',
            })
          }
        >
          {paused ? t('sheet.resume') : t('sheet.pause')}
        </Button>
      </section>

      {/* What cannot be undone, kept apart at the end */}
      <section
        className="space-y-3 border-t border-gray-300 pt-6 dark:border-gray-700"
        aria-labelledby={`${inputId}-danger`}
      >
        <h3 id={`${inputId}-danger`} className="text-lg font-bold text-gray-900 dark:text-gray-50">
          {t('sheet.danger')}
        </h3>
        <p className="text-base text-gray-700 dark:text-gray-200">{t('sheet.dismissNote')}</p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 border-[var(--color-semantic-error-1)] text-[var(--color-semantic-error-1)] dark:border-red-400 dark:text-red-300"
          onClick={() => setConfirmOpen(true)}
        >
          {t('sheet.dismiss')}
        </Button>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('sheet.dismissTitle', { name: employee.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>{t('sheet.dismissDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="min-h-11 md:min-h-10">
                {tCommon('cancel')}
              </AlertDialogCancel>
              <Button
                type="button"
                className="min-h-11 bg-red-700 text-white hover:bg-red-800 md:min-h-10 dark:bg-red-700 dark:hover:bg-red-800"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate({ organizationId, employeeId: employee.id })}
              >
                {dismiss.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                {t('sheet.dismiss')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </>
  );
}

function RunLog({ organizationId, employeeId }: { organizationId: string; employeeId: string }) {
  const t = useTranslations('aiOffice');
  const format = useFormatter();
  const runs = trpc.aiEmployees.runs.useQuery(
    { organizationId, employeeId },
    { refetchInterval: OFFICE_REFRESH_MS }
  );
  const headingId = useId();

  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-lg font-bold text-gray-900 dark:text-gray-50">
        {t('sheet.runs')}
      </h3>
      {runs.isLoading ? (
        <output className="block">
          <Loader2 className="h-5 w-5 animate-spin text-gray-500" aria-hidden="true" />
          <span className="sr-only">{t('loading')}</span>
        </output>
      ) : runs.error ? (
        <p className="text-base text-[var(--color-semantic-error-1)] dark:text-red-300">
          {t('sheet.runsError')}
        </p>
      ) : !runs.data || runs.data.length === 0 ? (
        <p className="text-base text-gray-700 dark:text-gray-200">{t('sheet.runsEmpty')}</p>
      ) : (
        <Table>
          <TableCaption>{t('sheet.runsCaption')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('sheet.columns.startedAt')}</TableHead>
              <TableHead>{t('sheet.columns.trigger')}</TableHead>
              <TableHead>{t('sheet.columns.status')}</TableHead>
              <TableHead className="text-right">{t('sheet.columns.processed')}</TableHead>
              <TableHead>{t('sheet.columns.resultCode')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.data.map((run) => (
              <TableRow key={run.id}>
                <TableCell className="whitespace-nowrap">
                  {format.dateTime(new Date(run.startedAt), {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </TableCell>
                <TableCell>{t(`sheet.trigger.${run.trigger}`)}</TableCell>
                <TableCell>{t(`sheet.runStatus.${run.status}`)}</TableCell>
                <TableCell className="text-right tabular-nums">{run.processedCount}</TableCell>
                <TableCell className="font-mono text-sm">{run.resultCode ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
