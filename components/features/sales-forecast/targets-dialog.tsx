'use client';

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
import { DEAL_LIMITS } from '@/lib/features/deals/types/schemas';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { trpc } from '@/lib/trpc/client';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';

/** Key of the organization-wide row among the members' user ids */
const ORGANIZATION = '__organization__';
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

interface TargetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

const parseAmount = (text: string): number | null | 'invalid' => {
  const trimmed = text.trim().replaceAll(',', '');
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  const value = Number(trimmed);
  return value <= DEAL_LIMITS.amount ? value : 'invalid';
};

/**
 * Set the month's won amount targets for the whole organization and each member (Refs #437),
 * and the month the fiscal year starts. Owners and admins only (the router checks it too).
 */
export function TargetsDialog({ open, onOpenChange, organizationId }: TargetsDialogProps) {
  const t = useTranslations('salesForecast.targets');
  const tCommon = useTranslations('common');
  const id = useId();
  const utils = trpc.useUtils();
  const [fiscalYear, setFiscalYear] = useState<number | undefined>(undefined);
  const [month, setMonth] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
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
    onSuccess: () => {
      refresh();
      toast.success(t('saved'));
      onOpenChange(false);
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

  // Fill the boxes with the stored targets of the month
  useEffect(() => {
    if (!data || !selectedMonth) return;
    const stored = (userId: string | null) =>
      data.targets.find((target) => target.userId === userId && target.month === selectedMonth)
        ?.amount;
    const text = (value: number | undefined) => (value === undefined ? '' : String(value));
    setAmounts({
      [ORGANIZATION]: text(stored(null)),
      ...Object.fromEntries(
        data.members.map((member) => [member.userId, text(stored(member.userId))])
      ),
    });
    setSubmitted(false);
  }, [data, selectedMonth]);

  useEffect(() => {
    if (!open) {
      setFiscalYear(undefined);
      setMonth(null);
    }
  }, [open]);

  const rows = data
    ? [
        { key: ORGANIZATION, userId: null, label: t('organization') },
        ...data.members.map((member) => ({
          key: member.userId,
          userId: member.userId,
          label: member.displayName,
        })),
      ]
    : [];
  const parsed = Object.fromEntries(
    rows.map((row) => [row.key, parseAmount(amounts[row.key] ?? '')])
  );
  const invalid = rows.some((row) => parsed[row.key] === 'invalid');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!selectedMonth || invalid) return;
    save.mutate({
      organizationId,
      entries: rows.map((row) => ({
        userId: row.userId,
        month: selectedMonth,
        amount: parsed[row.key] as number | null,
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          {!data ? (
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" aria-hidden="true" />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-[1.5fr_1fr_1fr]">
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-year`}>{t('fiscalYear')}</Label>
                  <Select
                    value={String(data.fiscalYear)}
                    onValueChange={(value) => {
                      setFiscalYear(Number(value));
                      setMonth(null);
                    }}
                  >
                    <SelectTrigger id={`${id}-year`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[data.fiscalYear - 1, data.fiscalYear, data.fiscalYear + 1].map((year) => (
                        <SelectItem key={year} value={String(year)}>
                          {t('fiscalYearOption', {
                            year,
                            from: `${year}/${data.fiscalYearStartMonth}`,
                          })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-start`}>{t('startMonth')}</Label>
                  <Select
                    value={String(data.fiscalYearStartMonth)}
                    onValueChange={(value) =>
                      setStart.mutate({ organizationId, month: Number(value) })
                    }
                    disabled={setStart.isPending}
                  >
                    <SelectTrigger id={`${id}-start`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {t('startMonthOption', { month: value })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-month`}>{t('month')}</Label>
                  <Select value={selectedMonth ?? undefined} onValueChange={setMonth}>
                    <SelectTrigger id={`${id}-month`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {data.months.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value.slice(0, 7)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <fieldset className="space-y-3">
                <legend className="sr-only">{t('month')}</legend>
                {rows.map((row) => {
                  const inputId = `${id}-${row.key}`;
                  const bad = submitted && parsed[row.key] === 'invalid';
                  return (
                    <div
                      key={row.key}
                      className="grid items-center gap-1.5 sm:grid-cols-[1fr_12rem]"
                    >
                      <Label htmlFor={inputId}>{row.label}</Label>
                      <div>
                        <Input
                          id={inputId}
                          inputMode="numeric"
                          value={amounts[row.key] ?? ''}
                          aria-invalid={bad}
                          aria-describedby={
                            row.userId === null
                              ? `${id}-organization-help`
                              : bad
                                ? `${inputId}-error`
                                : undefined
                          }
                          onChange={(event) =>
                            setAmounts((current) => ({ ...current, [row.key]: event.target.value }))
                          }
                        />
                        {bad && (
                          <p
                            id={`${inputId}-error`}
                            className="text-sm text-red-600 dark:text-red-400"
                          >
                            {t('amountInvalid')}
                          </p>
                        )}
                      </div>
                      {row.userId === null && (
                        <p
                          id={`${id}-organization-help`}
                          className="text-xs text-gray-500 sm:col-span-2 dark:text-gray-400"
                        >
                          {t('organizationHelp')}
                        </p>
                      )}
                    </div>
                  );
                })}
              </fieldset>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={!data || save.isPending}>
              {t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
