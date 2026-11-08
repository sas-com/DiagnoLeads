'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { formatYen, parseAmount } from '@/components/features/deals/deal-format';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { fiscalYearOf } from '@/lib/features/sales-targets/types/fiscal-year';
import { trpc } from '@/lib/trpc/client';
import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { formatMonthName, formatYearMonth } from './forecast-format';

/** Key of the organization-wide row among the members' user ids */
const ORGANIZATION = '__organization__';
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

interface TargetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

/** The fiscal year and month shown; undefined / null: the current ones */
interface Selection {
  fiscalYear: number | undefined;
  month: string | null;
}

/**
 * Set the month's won amount targets for the whole organization and each member (Refs #437),
 * and the month the fiscal year starts. Owners and admins only (the router checks it too).
 * Only the boxes that changed are sent, so two people editing other boxes do not undo each
 * other. Someone who left keeps their row while they hold a target, which can only be removed.
 * The fiscal year start is the organization's setting: it is saved on its own, after a question.
 * "Save and next month" keeps the dialog open on the month after, with the focus on its first box
 * (#721). Closing with unsaved boxes asks first, like switching the month.
 */
export function TargetsDialog({ open, onOpenChange, organizationId }: TargetsDialogProps) {
  const t = useTranslations('salesForecast.targets');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const id = useId();
  const boxRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const contentRef = useRef<HTMLDivElement>(null);
  // Why the organization's box takes the focus once it is there: the month after was asked for,
  // or the dialog opened before the targets came (then only while nothing else has the focus)
  const focusBoxes = useRef<'next' | 'open' | null>(null);
  const utils = trpc.useUtils();
  const [fiscalYear, setFiscalYear] = useState<number | undefined>(undefined);
  const [month, setMonth] = useState<string | null>(null);
  // What was typed in the boxes, by month and row; the other boxes show the stored targets
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  // A switch of the year or month held while asking to drop the unsaved boxes
  const [pendingSwitch, setPendingSwitch] = useState<Selection | null>(null);
  // The start month asked about, kept while the question closes so its title stays
  const [startAsk, setStartAsk] = useState<{ open: boolean; month: number } | null>(null);
  // Closing with unsaved boxes, held while asking to drop them
  const [closeAsk, setCloseAsk] = useState(false);
  // Which save button was pressed: it says it is saving
  const [savingFor, setSavingFor] = useState<'close' | 'next'>('close');
  const query = trpc.salesTargets.get.useQuery(
    { organizationId, ...(fiscalYear ? { fiscalYear } : {}) },
    { enabled: open && !!organizationId }
  );
  const data = query.data;
  const refresh = () => {
    void utils.salesTargets.invalidate();
    void utils.salesForecast.invalidate();
  };
  const save = trpc.salesTargets.save.useMutation({
    onSuccess: (_data, { entries }) => {
      refresh();
      toast.success(t('saved', { month: formatYearMonth(entries[0].month, locale) }));
    },
    onError: () => toast.error(t('error')),
  });
  const setStart = trpc.salesTargets.setFiscalYearStart.useMutation({
    onSuccess: () => {
      refresh();
      toast.success(t('startSaved'));
    },
    onError: () => toast.error(t('error')),
  });

  const today = `${jstDate().slice(0, 7)}-01`;
  const selectedMonth =
    data && month && data.months.includes(month)
      ? month
      : data
        ? data.months.includes(today)
          ? today
          : data.months[0]
        : null;

  const storedAmount = (userId: string | null) =>
    data?.targets.find((target) => target.userId === userId && target.month === selectedMonth)
      ?.amount ?? null;
  const draftKey = (key: string) => `${selectedMonth}|${key}`;
  const boxText = (row: { key: string; userId: string | null }) => {
    const stored = storedAmount(row.userId);
    return drafts[draftKey(row.key)] ?? (stored === null ? '' : String(stored));
  };

  useEffect(() => {
    if (!open) {
      setFiscalYear(undefined);
      setMonth(null);
      setDrafts({});
      setSubmitted(false);
      focusBoxes.current = null;
    }
  }, [open]);

  // The month's boxes came (another month, or the targets at last): to the organization's box
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the boxes change
  useEffect(() => {
    const reason = focusBoxes.current;
    const box = boxRefs.current[ORGANIZATION];
    if (!reason || !data || !box) return;
    focusBoxes.current = null;
    if (reason === 'next' || document.activeElement === contentRef.current) box.focus();
  }, [data, selectedMonth]);

  const rows = data
    ? [
        { key: ORGANIZATION, userId: null, label: t('organization'), former: false },
        ...data.members.map((member) => ({
          key: member.userId,
          userId: member.userId,
          label: member.displayName,
          former: false,
        })),
        ...data.formerMembers
          .filter((holder) => storedAmount(holder.userId) !== null)
          .map((holder) => ({
            key: holder.userId,
            userId: holder.userId,
            label: holder.displayName ?? t('formerMember'),
            former: true,
          })),
      ]
    : [];
  const parsed = Object.fromEntries(
    rows.map((row) => {
      const value = parseAmount(boxText(row));
      // Someone who left cannot be given a target, only have theirs removed
      const refused = row.former && value !== null && value !== storedAmount(row.userId);
      return [row.key, refused ? 'former' : value];
    })
  );
  const invalidRow = rows.find(
    (row) => parsed[row.key] === 'invalid' || parsed[row.key] === 'former'
  );
  const invalid = invalidRow !== undefined;
  // What the members' boxes add up to, shown under the organization's box
  const membersTotal = rows
    .filter((row) => row.userId !== null)
    .reduce((sum, row) => {
      const value = parsed[row.key];
      return typeof value === 'number' ? sum + value : sum;
    }, 0);
  // A box that differs from the stored target: to save, or not valid yet
  const unsaved = rows.some((row) => parsed[row.key] !== storedAmount(row.userId));

  const applySwitch = (next: Selection) => {
    setFiscalYear(next.fiscalYear);
    setMonth(next.month);
    setDrafts({});
    setSubmitted(false);
  };
  // Another year or month shows its stored targets: ask first when a box is unsaved
  const switchTo = (next: Selection) => {
    if (unsaved) setPendingSwitch(next);
    else applySwitch(next);
  };
  // Closing drops the boxes too: ask first when one is unsaved
  const requestClose = () => {
    if (unsaved) setCloseAsk(true);
    else onOpenChange(false);
  };

  const changeStart = (startMonth: number) => {
    if (!selectedMonth) return;
    const shown = selectedMonth;
    const [year, monthOfYear] = shown.split('-').map(Number);
    setStart.mutate(
      { organizationId, month: startMonth },
      {
        // Stay on the month being edited, in its fiscal year from the new start, so the
        // boxes typed in are kept
        onSuccess: () => {
          setFiscalYear(fiscalYearOf(year, monthOfYear, startMonth));
          setMonth(shown);
        },
      }
    );
  };

  // The month after the one shown, in the next fiscal year after the last month
  const goToNextMonth = () => {
    if (!data || !selectedMonth) return;
    focusBoxes.current = 'next';
    const index = data.months.indexOf(selectedMonth);
    if (index >= 0 && index < data.months.length - 1) {
      applySwitch({ fiscalYear, month: data.months[index + 1] });
      return;
    }
    const [year, monthOfYear] = selectedMonth.split('-').map(Number);
    const next =
      monthOfYear === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(monthOfYear + 1).padStart(2, '0')}-01`;
    applySwitch({ fiscalYear: data.fiscalYear + 1, month: next });
  };

  /** Save the boxes that changed, then close or show the month after */
  const saveBoxes = (then: 'close' | 'next') => {
    // The errors are on the screen before the focus moves, so the box is read with its error
    flushSync(() => setSubmitted(true));
    if (!selectedMonth) return;
    if (invalidRow) {
      boxRefs.current[invalidRow.key]?.focus();
      return;
    }
    setSavingFor(then);
    const done = then === 'close' ? () => onOpenChange(false) : goToNextMonth;
    const entries = rows
      .filter((row) => parsed[row.key] !== storedAmount(row.userId))
      .map((row) => ({
        userId: row.userId,
        month: selectedMonth,
        amount: parsed[row.key] as number | null,
      }));
    if (entries.length === 0) {
      done();
      return;
    }
    save.mutate({ organizationId, entries }, { onSuccess: done });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveBoxes('close');
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
      <DialogContent
        ref={contentRef}
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          // Before the targets come there is no box to start in: wait on the dialog itself
          if (data) return;
          event.preventDefault();
          contentRef.current?.focus();
          focusBoxes.current = 'open';
        }}
      >
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          {/* A failed refetch keeps the form: its boxes may hold unsaved input */}
          {data ? (
            <>
              <div className="grid gap-4 sm:grid-cols-[1.5fr_1fr]">
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-year`}>{t('fiscalYear')}</Label>
                  <Select
                    value={String(data.fiscalYear)}
                    onValueChange={(value) => switchTo({ fiscalYear: Number(value), month: null })}
                    disabled={setStart.isPending}
                  >
                    <SelectTrigger id={`${id}-year`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[data.fiscalYear - 1, data.fiscalYear, data.fiscalYear + 1].map((year) => (
                        <SelectItem key={year} value={String(year)}>
                          {t('fiscalYearOption', {
                            year,
                            from: formatYearMonth(
                              `${year}-${String(data.fiscalYearStartMonth).padStart(2, '0')}-01`,
                              locale
                            ),
                          })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-month`}>{t('month')}</Label>
                  <Select
                    value={selectedMonth ?? undefined}
                    onValueChange={(value) => switchTo({ fiscalYear, month: value })}
                    disabled={setStart.isPending}
                  >
                    <SelectTrigger id={`${id}-month`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {data.months.map((value) => (
                        <SelectItem key={value} value={value}>
                          {formatYearMonth(value, locale)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                  {selectedMonth &&
                    t('monthLegend', { month: formatYearMonth(selectedMonth, locale) })}
                </legend>
                {rows.map((row) => {
                  const inputId = `${id}-${row.key}`;
                  const error = submitted ? parsed[row.key] : null;
                  const bad = error === 'invalid' || error === 'former';
                  const helpId =
                    row.userId === null
                      ? `${id}-organization-help`
                      : row.former
                        ? `${inputId}-former-help`
                        : undefined;
                  return (
                    <div
                      key={row.key}
                      className="grid items-center gap-1.5 sm:grid-cols-[1fr_12rem]"
                    >
                      <Label htmlFor={inputId}>{row.label}</Label>
                      <div>
                        <Input
                          ref={(element) => {
                            boxRefs.current[row.key] = element;
                          }}
                          id={inputId}
                          inputMode="numeric"
                          value={boxText(row)}
                          aria-invalid={bad}
                          aria-describedby={
                            [helpId, bad ? `${inputId}-error` : undefined]
                              .filter(Boolean)
                              .join(' ') || undefined
                          }
                          onChange={(event) => {
                            const text = event.target.value;
                            setDrafts((current) => ({ ...current, [draftKey(row.key)]: text }));
                          }}
                        />
                        {bad && (
                          <p
                            id={`${inputId}-error`}
                            className="text-sm text-red-600 dark:text-red-400"
                          >
                            {t(error === 'former' ? 'formerMemberInvalid' : 'amountInvalid')}
                          </p>
                        )}
                      </div>
                      {helpId && (
                        <p
                          id={helpId}
                          className="text-sm text-gray-600 sm:col-span-2 dark:text-gray-300"
                        >
                          {t(row.former ? 'formerMemberHelp' : 'organizationHelp')}
                          {row.userId === null && (
                            <span className="block">
                              {t('membersTotal', { amount: formatYen(membersTotal, locale) ?? '' })}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  );
                })}
              </fieldset>

              <section
                aria-labelledby={`${id}-settings`}
                className="space-y-1.5 border-t border-gray-200 pt-4 dark:border-gray-800"
              >
                <h3
                  id={`${id}-settings`}
                  className="text-sm font-semibold text-gray-900 dark:text-gray-50"
                >
                  {t('organizationSettings')}
                </h3>
                <div className="grid items-center gap-1.5 sm:grid-cols-[1fr_12rem]">
                  <Label htmlFor={`${id}-start`}>{t('startMonth')}</Label>
                  <Select
                    value={String(data.fiscalYearStartMonth)}
                    onValueChange={(value) => setStartAsk({ open: true, month: Number(value) })}
                    disabled={setStart.isPending}
                  >
                    <SelectTrigger id={`${id}-start`} aria-describedby={`${id}-start-help`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {formatMonthName(value, locale)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p
                    id={`${id}-start-help`}
                    className="text-sm text-gray-600 sm:col-span-2 dark:text-gray-300"
                  >
                    {t('startMonthHelp')}
                  </p>
                </div>
              </section>
            </>
          ) : query.isError ? (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-red-200 p-4 dark:border-red-900"
            >
              <p className="text-sm text-red-700 dark:text-red-400">{t('loadError')}</p>
              <Button type="button" variant="outline" onClick={() => void query.refetch()}>
                {tCommon('retry')}
              </Button>
            </div>
          ) : (
            <output className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" aria-hidden="true" />
              {tCommon('loading')}
            </output>
          )}

          {/* In sight however many members there are */}
          <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 gap-2 border-t border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
            <Button type="button" variant="outline" className={TAP_TARGET} onClick={requestClose}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className={TAP_TARGET}
              disabled={!data || save.isPending}
              onClick={() => saveBoxes('next')}
            >
              {save.isPending && savingFor === 'next' ? t('saving') : t('saveAndNext')}
            </Button>
            <Button type="submit" className={TAP_TARGET} disabled={!data || save.isPending}>
              {save.isPending && savingFor === 'close' ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </form>

        <AlertDialog
          open={pendingSwitch !== null}
          onOpenChange={(next) => {
            if (!next) setPendingSwitch(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('discardTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('discardDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => pendingSwitch && applySwitch(pendingSwitch)}
                className="bg-red-600 hover:bg-red-700"
              >
                {t('discardConfirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={closeAsk} onOpenChange={setCloseAsk}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('discardTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('closeDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onOpenChange(false)}
                className="bg-red-600 hover:bg-red-700"
              >
                {t('closeConfirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={startAsk?.open ?? false}
          onOpenChange={(next) => {
            if (!next) setStartAsk((current) => current && { ...current, open: false });
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('startConfirmTitle', {
                  month: startAsk ? formatMonthName(startAsk.month, locale) : '',
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>{t('startConfirmDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => startAsk && changeStart(startAsk.month)}>
                {t('startConfirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
