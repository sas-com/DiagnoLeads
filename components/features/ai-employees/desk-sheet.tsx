'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
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
import type { OfficeEmployee } from '@/lib/features/ai-employees/service';
import {
  AI_EMPLOYEE_ROLE_DEFINITIONS,
  type AiEmployeeRole,
} from '@/lib/features/ai-employees/types/roles';
import { AI_EMPLOYEE_NAME_MAX_LENGTH } from '@/lib/features/ai-employees/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { DeskAvatar, DeskStatusLabel } from './desk-status';

/**
 * The details of one desk (Refs #1101): the role, the status, the work log, and for admins the
 * actions (hire on a vacant desk; rename, pause or resume, dismiss).
 */
export function DeskSheet({
  organizationId,
  role,
  employee,
  canManage,
  open,
  onOpenChange,
}: {
  organizationId: string;
  role: AiEmployeeRole | null;
  employee: OfficeEmployee | null;
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('aiOffice');
  const format = useFormatter();
  if (!role) return null;
  const status = employee?.deskStatus ?? 'vacant';
  const roleTitle = t(`roles.${role}.title`);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <DeskAvatar role={role} status={status} size="lg" />
            <div className="min-w-0">
              <SheetTitle className="truncate">
                {employee ? employee.name : t('sheet.vacantTitle', { role: roleTitle })}
              </SheetTitle>
              <DeskStatusLabel status={status} className="mt-1" />
            </div>
          </div>
          <SheetDescription>{t(`roles.${role}.description`)}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-8">
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
            <dt className="text-gray-600 dark:text-gray-300">{t('sheet.status')}</dt>
            <dd className="text-gray-900 dark:text-gray-50">{t(`statusHint.${status}`)}</dd>
          </dl>

          {!employee &&
            (canManage ? (
              <HireForm organizationId={organizationId} role={role} />
            ) : (
              <p className="text-base text-gray-700 dark:text-gray-200">{t('sheet.readOnly')}</p>
            ))}

          {employee && canManage && (
            <ManageSection
              organizationId={organizationId}
              employee={employee}
              onDismissed={() => onOpenChange(false)}
            />
          )}

          {employee && <RunLog organizationId={organizationId} employeeId={employee.id} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function HireForm({ organizationId, role }: { organizationId: string; role: AiEmployeeRole }) {
  const t = useTranslations('aiOffice');
  const utils = trpc.useUtils();
  const inputId = useId();
  const [name, setName] = useState(() => t(`roles.${role}.defaultName`));
  const hire = trpc.aiEmployees.hire.useMutation({
    onSuccess: async () => {
      toast.success(t('toast.hired', { name: name.trim() }));
      await utils.aiEmployees.office.invalidate({ organizationId });
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
  const utils = trpc.useUtils();
  const inputId = useId();
  const [name, setName] = useState(employee.name);
  useEffect(() => setName(employee.name), [employee.name]);

  const refresh = () => utils.aiEmployees.office.invalidate({ organizationId });
  const update = trpc.aiEmployees.update.useMutation({
    onSuccess: async (updated, variables) => {
      if (variables.status === 'paused') toast.success(t('toast.paused', { name: updated.name }));
      else if (variables.status === 'active') {
        toast.success(t('toast.resumed', { name: updated.name }));
      } else toast.success(t('toast.renamed'));
      await refresh();
    },
    onError: () => toast.error(t('toast.error')),
  });
  const dismiss = trpc.aiEmployees.dismiss.useMutation({
    onSuccess: async () => {
      toast.success(t('toast.dismissed', { name: employee.name }));
      onDismissed();
      await refresh();
    },
    onError: () => toast.error(t('toast.error')),
  });

  const rename = (event: FormEvent) => {
    event.preventDefault();
    const next = name.trim();
    if (!next || next === employee.name) return;
    update.mutate({ organizationId, employeeId: employee.id, name: next });
  };
  const paused = employee.status === 'paused';

  return (
    <section className="space-y-4" aria-labelledby={`${inputId}-manage`}>
      <h3 id={`${inputId}-manage`} className="text-lg font-bold text-gray-900 dark:text-gray-50">
        {t('sheet.manage')}
      </h3>
      <form onSubmit={rename} className="space-y-1.5">
        <Label htmlFor={inputId}>{t('sheet.name')}</Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
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
      <div className="flex flex-wrap gap-2">
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
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 text-[var(--color-semantic-error-1)] dark:text-red-300"
              disabled={dismiss.isPending}
            >
              {t('sheet.dismiss')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('sheet.dismissTitle', { name: employee.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>{t('sheet.dismissDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('sheet.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => dismiss.mutate({ organizationId, employeeId: employee.id })}
              >
                {t('sheet.dismiss')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}

function RunLog({ organizationId, employeeId }: { organizationId: string; employeeId: string }) {
  const t = useTranslations('aiOffice.sheet');
  const format = useFormatter();
  const runs = trpc.aiEmployees.runs.useQuery({ organizationId, employeeId });
  const headingId = useId();

  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-lg font-bold text-gray-900 dark:text-gray-50">
        {t('runs')}
      </h3>
      {runs.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-gray-500" aria-hidden="true" />
      ) : runs.error ? (
        <p className="text-base text-[var(--color-semantic-error-1)] dark:text-red-300">
          {t('runsError')}
        </p>
      ) : !runs.data || runs.data.length === 0 ? (
        <p className="text-base text-gray-700 dark:text-gray-200">{t('runsEmpty')}</p>
      ) : (
        <Table>
          <TableCaption>{t('runsCaption')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.startedAt')}</TableHead>
              <TableHead>{t('columns.trigger')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead className="text-right">{t('columns.processed')}</TableHead>
              <TableHead>{t('columns.resultCode')}</TableHead>
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
                <TableCell>{t(`trigger.${run.trigger}`)}</TableCell>
                <TableCell>{t(`runStatus.${run.status}`)}</TableCell>
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
