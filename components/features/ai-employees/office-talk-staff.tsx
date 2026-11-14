'use client';

/**
 * The staff matters of an AI employee, inside the conversation of the full-screen office (#1170):
 * a new name, the work log, and the dismissal. The president asks the employee itself, where
 * hiring, pausing and resuming already are; the normal view keeps the same three (desk-sheet.tsx)
 * for a phone and a screen reader.
 *
 * - A new name is typed and saved, so it is not undone with Z like an order given with one key:
 *   it is changed again.
 * - The work log shows what was recorded, and says so when nothing was: never work that was not
 *   done.
 * - A dismissal cannot be taken back. It is carried out only once the name of the employee was
 *   typed: the keys of the choices alone, pressed on and on, never reach it (#1175).
 *
 * Back is Esc, handled by the office (the keys of the conversation are off while this is open).
 * While a matter is being saved there is no way back: Esc would look like giving it up, and the
 * request is already on its way (`onBusyChange`).
 */
import { Input } from '@/components/ui/input';
import {
  AI_EMPLOYEE_NAME_MAX_LENGTH,
  AI_EMPLOYEE_RUNS_LIMIT,
  type AiEmployeeRunStatus,
  type AiEmployeeRunTrigger,
} from '@/lib/features/ai-employees/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { CAP, FOCUS, KEY } from './office-hud';

export const STAFF_MATTERS = ['rename', 'log', 'dismiss'] as const;
export type StaffMatter = (typeof STAFF_MATTERS)[number];

/** How many runs of the work log the conversation shows: the latest ones */
export const TALK_LOG_ROWS = 6;

// The name as it reads: a Japanese input method types "ＡＩ" full-width where the name has "AI",
// and a pasted name may hold a composed letter in two parts or two spaces in a row
function asRead(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/**
 * Whether what was typed is the name of the employee, as the dismissal asks for. The width of a
 * letter and the spaces do not count; upper and lower case do.
 */
export function namesTheEmployee(typed: string, name: string): boolean {
  return asRead(name) !== '' && asRead(typed) === asRead(name);
}

// The field of the office, over the defaults of the shared input: the same by day and by night
// (the office follows the clock, not the theme), square, and with the focus ring of the office
const FIELD = cn(
  'min-h-11 rounded-none border-[#f5f1e8]/45 bg-[#0b1020] text-base text-[#f5f1e8] placeholder:text-[#8b93a8] focus-visible:border-[#e9cf9a] focus-visible:ring-0 focus-visible:ring-offset-0 md:text-base dark:border-[#f5f1e8]/45 dark:bg-[#0b1020] dark:text-[#f5f1e8] dark:focus-visible:ring-0',
  FOCUS
);
const ACTION =
  'flex min-h-12 w-full items-center justify-center gap-2 border px-4 text-base font-bold';

// Tells the office while the matter is being saved, and that it is over when the form goes away
function useBusy(busy: boolean, onBusyChange: (busy: boolean) => void) {
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
}

export function OfficeTalkStaff({
  matter,
  organizationId,
  employee,
  onDone,
  onBack,
  onBusyChange,
}: {
  matter: StaffMatter;
  organizationId: string;
  employee: { id: string; name: string };
  /** Carried out: what the employee (or the office, after a dismissal) says about it */
  onDone: (text: string) => void;
  onBack: () => void;
  /** Being saved (no way back meanwhile), and no longer */
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations('aiOffice.immersive.talk.staff');
  const [busy, setBusy] = useState(false);
  useBusy(busy, onBusyChange);
  return (
    <div className="flex flex-col gap-3">
      <h2
        // The work log has nothing to type in: its title takes the focus, so that the log is read
        // out from the top and Enter does nothing
        data-autofocus={matter === 'log' ? '' : undefined}
        tabIndex={matter === 'log' ? -1 : undefined}
        className={cn(CAP, 'outline-none')}
      >
        {t(`${matter}.title`)}
      </h2>
      {matter === 'rename' && (
        <Rename
          organizationId={organizationId}
          employee={employee}
          onDone={onDone}
          onBusyChange={setBusy}
        />
      )}
      {matter === 'log' && <WorkLog organizationId={organizationId} employeeId={employee.id} />}
      {matter === 'dismiss' && (
        <Dismissal
          organizationId={organizationId}
          employee={employee}
          onDone={onDone}
          onBusyChange={setBusy}
        />
      )}
      <button
        type="button"
        // Not disabled: a disabled button would drop the focus out of the conversation
        aria-disabled={busy}
        onClick={() => {
          if (!busy) onBack();
        }}
        className={cn(
          'flex min-h-11 w-full items-center gap-3 border border-[#f5f1e8]/45 bg-[#101726] px-4 text-left text-sm font-bold hover:border-[#e9cf9a] hover:bg-[#1c2540] aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
          FOCUS
        )}
      >
        <span className={KEY}>Esc</span>
        {t('back')}
      </button>
    </div>
  );
}

function Failure({ children }: { children: string }) {
  return (
    <p role="alert" className="text-sm font-bold text-[#fca5a5]">
      <AlertTriangle className="mr-1.5 inline h-4 w-4 align-[-2px]" aria-hidden="true" />
      {children}
    </p>
  );
}

function Rename({
  organizationId,
  employee,
  onDone,
  onBusyChange,
}: {
  organizationId: string;
  employee: { id: string; name: string };
  onDone: (text: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations('aiOffice.immersive.talk.staff');
  const inputId = useId();
  const [name, setName] = useState(employee.name);
  const update = trpc.aiEmployees.update.useMutation({
    // The name it had is said too: a name changed by a slip of the keys can be put back
    onSuccess: (updated) => onDone(t('rename.done', { from: employee.name, name: updated.name })),
  });
  useBusy(update.isPending, onBusyChange);
  const next = name.trim();
  const closed = !next || next === employee.name || update.isPending;
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (closed) return;
    update.mutate({ organizationId, employeeId: employee.id, name: next });
  };
  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm text-[#d8d2c4]">
        {t('rename.label')}
      </label>
      <Input
        id={inputId}
        data-autofocus=""
        value={name}
        maxLength={AI_EMPLOYEE_NAME_MAX_LENGTH}
        autoComplete="off"
        onChange={(event) => setName(event.target.value)}
        className={FIELD}
      />
      {update.isError && <Failure>{t('failed')}</Failure>}
      <button
        type="submit"
        aria-disabled={closed}
        className={cn(
          ACTION,
          'border-[#e9cf9a] bg-[#e9cf9a] text-[#1b2130] hover:bg-[#f3dfb4] aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
          FOCUS
        )}
      >
        {update.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {t('rename.save')}
      </button>
    </form>
  );
}

function WorkLog({ organizationId, employeeId }: { organizationId: string; employeeId: string }) {
  const runs = trpc.aiEmployees.runs.useQuery({ organizationId, employeeId });
  return (
    // Read out when the log arrives: the focus is on the title above it
    <div aria-live="polite" aria-busy={runs.isLoading} className="flex flex-col gap-3">
      <WorkLogRows loading={runs.isLoading} failed={Boolean(runs.error)} rows={runs.data ?? []} />
    </div>
  );
}

function WorkLogRows({
  loading,
  failed,
  rows,
}: {
  loading: boolean;
  failed: boolean;
  rows: {
    id: string;
    startedAt: Date | string;
    status: AiEmployeeRunStatus;
    trigger: AiEmployeeRunTrigger;
    processedCount: number;
  }[];
}) {
  const t = useTranslations('aiOffice.immersive.talk.staff');
  const tOffice = useTranslations('aiOffice');
  const format = useFormatter();
  if (loading) {
    return (
      <output className="block">
        <Loader2 className="h-5 w-5 animate-spin text-[#d8d2c4]" aria-hidden="true" />
        <span className="sr-only">{tOffice('loading')}</span>
      </output>
    );
  }
  if (failed) return <Failure>{tOffice('sheet.runsError')}</Failure>;
  if (rows.length === 0) {
    return <p className="text-sm leading-relaxed text-[#f5f1e8]">{tOffice('sheet.runsEmpty')}</p>;
  }
  const shown = rows.slice(0, TALK_LOG_ROWS);
  return (
    <>
      <ul className="flex flex-col divide-y divide-[#f5f1e8]/15 border-y border-[#f5f1e8]/15">
        {shown.map((run) => (
          <li key={run.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
            <span className="font-bold tabular-nums">
              {format.dateTime(new Date(run.startedAt), {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {/* A run that failed reads apart, by a mark and not by its color alone */}
            <span className={cn(run.status === 'failed' && 'font-bold text-[#fca5a5]')}>
              {run.status === 'failed' && (
                <AlertTriangle className="mr-1 inline h-4 w-4 align-[-2px]" aria-hidden="true" />
              )}
              {tOffice(`sheet.runStatus.${run.status}`)}
            </span>
            <span className="text-[#d8d2c4]">
              {tOffice(`sheet.trigger.${run.trigger}`)}
              {' ・ '}
              {t('log.processed', { count: run.processedCount })}
            </span>
          </li>
        ))}
      </ul>
      {/* Where the rest is: more runs than fit here, and what a failed one ended with */}
      {rows.length > TALK_LOG_ROWS && (
        <p className="text-xs leading-relaxed text-[#d8d2c4]">
          {t('log.more', { count: shown.length, limit: AI_EMPLOYEE_RUNS_LIMIT })}
        </p>
      )}
      {shown.some((run) => run.status === 'failed') && (
        <p className="text-xs leading-relaxed text-[#d8d2c4]">{t('log.failedDetail')}</p>
      )}
    </>
  );
}

function Dismissal({
  organizationId,
  employee,
  onDone,
  onBusyChange,
}: {
  organizationId: string;
  employee: { id: string; name: string };
  onDone: (text: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations('aiOffice.immersive.talk.staff');
  const tOffice = useTranslations('aiOffice');
  const inputId = useId();
  const noteId = useId();
  const labelId = useId();
  const [typed, setTyped] = useState('');
  // Asked for with a name that is not the employee's: said once, until the name is typed again
  const [refused, setRefused] = useState(false);
  const dismiss = trpc.aiEmployees.dismiss.useMutation({
    onSuccess: () => onDone(t('dismiss.done', { name: employee.name })),
  });
  useBusy(dismiss.isPending, onBusyChange);
  const named = namesTheEmployee(typed, employee.name);
  const closed = !named || dismiss.isPending;
  const carryOut = (event: FormEvent) => {
    event.preventDefault();
    if (!named) setRefused(true);
    if (closed) return;
    dismiss.mutate({ organizationId, employeeId: employee.id });
  };
  return (
    <form onSubmit={carryOut} className="flex flex-col gap-2">
      <p id={noteId} className="text-sm leading-relaxed text-[#f5f1e8]">
        {tOffice('sheet.dismissDescription')}
      </p>
      <label id={labelId} htmlFor={inputId} className="text-sm text-[#d8d2c4]">
        {t('dismiss.label', { name: employee.name })}
      </label>
      <Input
        id={inputId}
        data-autofocus=""
        value={typed}
        maxLength={AI_EMPLOYEE_NAME_MAX_LENGTH}
        autoComplete="off"
        aria-describedby={noteId}
        onChange={(event) => {
          setTyped(event.target.value);
          setRefused(false);
        }}
        className={FIELD}
      />
      {refused && !named && <Failure>{t('dismiss.mismatch')}</Failure>}
      {dismiss.isError && <Failure>{t('failed')}</Failure>}
      <button
        type="submit"
        aria-disabled={closed}
        // Why it is closed is read out with it: the name has to be typed
        aria-describedby={labelId}
        className={cn(
          ACTION,
          // Closed until the name was typed: an outline only, so that it does not read as ready
          named
            ? 'border-[#fca5a5] bg-[#7f1d1d] text-white hover:bg-[#991b1b] aria-disabled:opacity-60'
            : 'cursor-not-allowed border-[#fca5a5]/50 bg-transparent text-[#fca5a5]/70',
          FOCUS
        )}
      >
        {dismiss.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {t('dismiss.confirm', { name: employee.name })}
      </button>
    </form>
  );
}
