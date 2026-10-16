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
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  type AgencyContractFields,
  agencyContractFieldsSchema,
} from '@/lib/features/agency-contracts/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

type Contract = AgencyContractFields & { id: string };

/** Text fields of the form; amounts stay text until saved so a field can be left blank */
type FormValues = Record<
  | 'agencyName'
  | 'startsOn'
  | 'endsOn'
  | 'initialFee'
  | 'monthlyFee'
  | 'prepayment'
  | 'feePerAppointment'
  | 'planAppointments'
  | 'planCostPerAppointment'
  | 'note',
  string
>;

const AMOUNT_FIELDS = ['initialFee', 'monthlyFee', 'prepayment', 'feePerAppointment'] as const;
const PLAN_FIELDS = ['planAppointments', 'planCostPerAppointment'] as const;

const toForm = (contract?: Contract): FormValues => ({
  agencyName: contract?.agencyName ?? '',
  startsOn: contract?.startsOn ?? '',
  endsOn: contract?.endsOn ?? '',
  initialFee: String(contract?.initialFee ?? ''),
  monthlyFee: String(contract?.monthlyFee ?? ''),
  prepayment: String(contract?.prepayment ?? ''),
  feePerAppointment: String(contract?.feePerAppointment ?? ''),
  planAppointments: contract?.planAppointments == null ? '' : String(contract.planAppointments),
  planCostPerAppointment:
    contract?.planCostPerAppointment == null ? '' : String(contract.planCostPerAppointment),
  note: contract?.note ?? '',
});

const amount = (value: string) => (value.trim() === '' ? 0 : Number(value.replace(/,/g, '')));
const optionalAmount = (value: string) =>
  value.trim() === '' ? null : Number(value.replace(/,/g, ''));

/** Contracts with sales agencies: fees and plan per term (#148). Owners and admins only. */
export function AgencyContractsManager({
  organizationId,
  agencyNames,
}: {
  organizationId: string;
  /** Agency names of the issued links, offered as suggestions */
  agencyNames: string[];
}) {
  const t = useTranslations('settings.agencyContracts');
  const format = useFormatter();
  const locale = useLocale();
  const utils = trpc.useUtils();
  const contracts = trpc.agencyContracts.list.useQuery({ organizationId }, { retry: false });
  const [editing, setEditing] = useState<Contract | 'new' | null>(null);
  const [form, setForm] = useState<FormValues>(toForm());
  const [removing, setRemoving] = useState<Contract | null>(null);

  const refresh = () => {
    utils.agencyContracts.list.invalidate();
    utils.agencyContracts.report.invalidate();
  };
  const onSaveError = (error: { data?: { code?: string } | null }) =>
    toast.error(error.data?.code === 'CONFLICT' ? t('overlap') : t('saveError'));
  const create = trpc.agencyContracts.create.useMutation({
    onSuccess: () => {
      setEditing(null);
      refresh();
      toast.success(t('saved'));
    },
    onError: onSaveError,
  });
  const update = trpc.agencyContracts.update.useMutation({
    onSuccess: () => {
      setEditing(null);
      refresh();
      toast.success(t('saved'));
    },
    onError: onSaveError,
  });
  const remove = trpc.agencyContracts.remove.useMutation({
    onSuccess: () => {
      setRemoving(null);
      refresh();
      toast.success(t('removed'));
    },
    onError: () => toast.error(t('removeError')),
  });

  // Members who cannot manage settings never see the fees
  if (contracts.error?.data?.code === 'FORBIDDEN') return null;

  const yen = (value: number | null) =>
    value === null
      ? '—'
      : new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
          style: 'currency',
          currency: 'JPY',
        }).format(value);
  const day = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: 'medium' });

  const open = (contract?: Contract) => {
    setForm(toForm(contract));
    setEditing(contract ?? 'new');
  };

  const save = () => {
    const parsed = agencyContractFieldsSchema.safeParse({
      agencyName: form.agencyName,
      startsOn: form.startsOn,
      endsOn: form.endsOn || null,
      ...Object.fromEntries(AMOUNT_FIELDS.map((key) => [key, amount(form[key])])),
      ...Object.fromEntries(PLAN_FIELDS.map((key) => [key, optionalAmount(form[key])])),
      note: form.note,
    });
    if (!parsed.success) {
      toast.error(t('invalid'));
      return;
    }
    if (editing === 'new') create.mutate({ organizationId, contract: parsed.data });
    else if (editing) update.mutate({ organizationId, id: editing.id, contract: parsed.data });
  };

  const field = (key: keyof FormValues, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`contract-${key}`}>{t(`fields.${key}`)}</Label>
      <Input
        id={`contract-${key}`}
        value={form[key]}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        {...props}
      />
    </div>
  );
  const yenField = (key: keyof FormValues) =>
    field(key, { inputMode: 'numeric', type: 'number', min: 0, step: 1, placeholder: '0' });

  const pending = create.isPending || update.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={() => open()}>
          <Plus className="mr-1 h-4 w-4" />
          {t('add')}
        </Button>
        {contracts.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : !contracts.data || contracts.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('fields.agencyName')}</TableHead>
                  <TableHead>{t('termHeader')}</TableHead>
                  <TableHead className="text-right">{t('fields.initialFee')}</TableHead>
                  <TableHead className="text-right">{t('fields.monthlyFee')}</TableHead>
                  <TableHead className="text-right">{t('fields.prepayment')}</TableHead>
                  <TableHead className="text-right">{t('fields.feePerAppointment')}</TableHead>
                  <TableHead className="text-right">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.data.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell className="font-medium">{contract.agencyName}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {day(contract.startsOn)} 〜{' '}
                      {contract.endsOn ? day(contract.endsOn) : t('ongoing')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {yen(contract.initialFee)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {yen(contract.monthlyFee)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {yen(contract.prepayment)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {yen(contract.feePerAppointment)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => open(contract)}>
                          <Pencil className="mr-1 h-4 w-4" />
                          {t('edit')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setRemoving(contract)}>
                          <Trash2 className="mr-1 h-4 w-4" />
                          {t('remove')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(isOpen) => !isOpen && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? t('addTitle') : t('editTitle')}</DialogTitle>
            <DialogDescription>{t('formDescription')}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="sm:col-span-2">
              {field('agencyName', {
                list: 'agency-contract-names',
                maxLength: 200,
                required: true,
              })}
              <datalist id="agency-contract-names">
                {agencyNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <p className="mt-1 text-xs text-muted-foreground">{t('agencyNameHint')}</p>
            </div>
            {field('startsOn', { type: 'date', required: true })}
            {field('endsOn', { type: 'date' })}
            {yenField('initialFee')}
            {yenField('monthlyFee')}
            {yenField('prepayment')}
            {yenField('feePerAppointment')}
            <p className="text-xs text-muted-foreground sm:col-span-2">{t('costRule')}</p>
            {field('planAppointments', { inputMode: 'numeric', type: 'number', min: 1, step: 1 })}
            {yenField('planCostPerAppointment')}
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="contract-note">{t('fields.note')}</Label>
              <Textarea
                id="contract-note"
                rows={2}
                maxLength={1000}
                value={form.note}
                onChange={(event) => setForm({ ...form, note: event.target.value })}
              />
            </div>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {t('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removing} onOpenChange={(isOpen) => !isOpen && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removeConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {removing ? t('removeConfirmBody', { agency: removing.agencyName }) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (removing) remove.mutate({ organizationId, id: removing.id });
              }}
              disabled={remove.isPending}
            >
              {t('remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
