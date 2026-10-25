'use client';

import { HearingDateInput } from '@/components/features/lead-hearings/hearing-date-inputs';
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
import type { DealView } from '@/lib/features/deals/service';
import {
  DEAL_KINDS,
  DEAL_STAGES,
  type DealKind,
  type DealStage,
  FORECAST_OVERRIDES,
  type ForecastOverride,
  STAGE_PROBABILITY,
  forecastCategory,
} from '@/lib/features/deals/types/pipeline';
import { DEAL_LIMITS } from '@/lib/features/deals/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useEffect, useId, useState } from 'react';
import { isDealDate, parseWhole } from './deal-format';
import { LostReasonDialog, type LostValues } from './lost-reason-dialog';
import { useDealMutations } from './use-deal-mutations';

/** Select value for "nobody" / "automatic" (Radix needs non-empty values) */
const NONE = '__none__';
/** Select value of a new deal's owner left to the server (the lead's assignee) */
const LEAD_ASSIGNEE = '__lead__';

interface DealFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** The lead of a new deal; without it the dialog asks for one */
  leadId?: string;
  /** The deal to edit; without it the dialog creates one */
  deal?: DealView;
  onSaved?: (deal: DealView) => void;
}

interface FormState {
  name: string;
  kind: DealKind;
  stage: DealStage;
  amount: string;
  probability: string;
  forecastOverride: ForecastOverride | null;
  expectedCloseOn: string | undefined;
  ownerUserId: string | null | undefined;
  nextStep: string;
}

const emptyState = (deal?: DealView): FormState => ({
  name: deal?.name ?? '',
  kind: deal?.kind ?? 'survey',
  stage: deal?.stage ?? 'qualification',
  amount: deal?.amount === null || deal?.amount === undefined ? '' : String(deal.amount),
  probability: deal ? String(deal.probability) : '',
  forecastOverride: deal?.forecastOverride ?? null,
  expectedCloseOn: deal?.expectedCloseOn ?? undefined,
  // undefined: the server picks the lead's assignee, else the creator (new deals only)
  ownerUserId: deal ? deal.ownerUserId : undefined,
  nextStep: deal?.nextStep ?? '',
});

/** What the form sends; an empty probability and an owner left to the server are not sent */
function formValues(form: FormState) {
  const amount = parseWhole(form.amount, DEAL_LIMITS.amount);
  const probability = parseWhole(form.probability, 100);
  return {
    name: form.name.trim(),
    kind: form.kind,
    amount: amount === 'invalid' ? null : amount,
    expectedCloseOn: form.expectedCloseOn ?? null,
    nextStep: form.nextStep.trim() || null,
    forecastOverride: form.forecastOverride,
    ...(typeof probability === 'number' ? { probability } : {}),
    ...(form.ownerUserId !== undefined ? { ownerUserId: form.ownerUserId } : {}),
  };
}

type FormValues = ReturnType<typeof formValues>;

/** The values that differ from those the form was opened with */
function changedValues(values: FormValues, opened: FormValues): Partial<FormValues> {
  const changed: Partial<FormValues> = {};
  const copy = <K extends keyof FormValues>(key: K) => {
    if (values[key] !== opened[key]) changed[key] = values[key];
  };
  for (const key of Object.keys(values) as (keyof FormValues)[]) copy(key);
  return changed;
}

/**
 * Create a deal for a lead, or edit one (Refs #436). The stage of an existing deal is changed
 * on the board or the deal page; creating one directly as lost asks for the lost reason, and as
 * won says what it does to the lead. Editing sends only the fields changed in the dialog, so it
 * does not write back a value changed elsewhere meanwhile (a stage move resets the probability).
 */
export function DealFormDialog({
  open,
  onOpenChange,
  organizationId,
  leadId,
  deal,
  onSaved,
}: DealFormDialogProps) {
  const t = useTranslations('deals');
  const tCommon = useTranslations('common');
  const id = useId();
  const editing = !!deal;
  const [state, setState] = useState<FormState>(() => emptyState(deal));
  // The values the dialog was opened with, which editing compares against
  const [initial, setInitial] = useState<FormState>(() => emptyState(deal));
  const [lead, setLead] = useState<{ id: string; label: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  // The close date box holds text that is not a date (it shows its own error)
  const [closeUnreadable, setCloseUnreadable] = useState(false);
  const { create, update } = useDealMutations();
  const members = trpc.leads.assignees.useQuery({ organizationId }, { enabled: open });

  useEffect(() => {
    if (!open) return;
    const opened = emptyState(deal);
    setState(opened);
    setInitial(opened);
    setLead(null);
    setSubmitted(false);
  }, [open, deal]);

  // The date box is mounted anew, without typed text, each time the dialog opens
  useEffect(() => {
    if (open) setCloseUnreadable(false);
  }, [open]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((current) => ({ ...current, [key]: value }));

  const amount = parseWhole(state.amount, DEAL_LIMITS.amount);
  const probability = parseWhole(state.probability, 100);
  const chosenLeadId = leadId ?? lead?.id;
  const errors = {
    lead: !editing && !chosenLeadId,
    name: state.name.trim() === '',
    amount: amount === 'invalid',
    probability: probability === 'invalid',
    // A date the deals do not take (outside 2000-2100) is refused by the API too
    expectedCloseOn:
      closeUnreadable || (!!state.expectedCloseOn && !isDealDate(state.expectedCloseOn)),
  };
  const invalid = Object.values(errors).some(Boolean);
  const pending = create.isPending || update.isPending;
  const autoCategory = forecastCategory({
    stage: state.stage,
    probability: typeof probability === 'number' ? probability : STAGE_PROBABILITY[state.stage],
    forecastOverride: null,
  });

  const save = (lost?: LostValues) => {
    const values = formValues(state);
    const done = (saved: DealView) => {
      setLostOpen(false);
      onOpenChange(false);
      onSaved?.(saved);
    };
    if (deal) {
      const changed = changedValues(values, formValues(initial));
      if (Object.keys(changed).length === 0) {
        onOpenChange(false);
        return;
      }
      update.mutate({ organizationId, dealId: deal.id, ...changed }, { onSuccess: done });
    } else if (chosenLeadId) {
      create.mutate(
        { organizationId, leadId: chosenLeadId, stage: state.stage, ...values, ...lost },
        { onSuccess: done }
      );
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (invalid) return;
    if (!editing && state.stage === 'lost') {
      setLostOpen(true);
      return;
    }
    save();
  };

  const fieldError = (show: boolean, key: string, message: string) =>
    submitted && show ? (
      <p id={`${id}-${key}-error`} className="text-sm text-red-600 dark:text-red-400">
        {message}
      </p>
    ) : null;
  const describedBy = (show: boolean, key: string) =>
    submitted && show ? `${id}-${key}-error` : undefined;

  return (
    <>
      <Dialog open={open && !lostOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>{editing ? t('form.editTitle') : t('form.createTitle')}</DialogTitle>
              <DialogDescription className="sr-only">{t('description')}</DialogDescription>
            </DialogHeader>

            {!editing && !leadId && (
              <LeadPicker
                organizationId={organizationId}
                inputId={`${id}-lead`}
                value={lead}
                onChange={setLead}
                error={fieldError(errors.lead, 'lead', t('form.leadRequired'))}
                describedBy={describedBy(errors.lead, 'lead')}
              />
            )}

            <div className="space-y-1.5">
              <Label htmlFor={`${id}-name`}>
                {t('fields.name')} <RequiredMark />
              </Label>
              <Input
                id={`${id}-name`}
                value={state.name}
                maxLength={DEAL_LIMITS.name}
                placeholder={t('form.namePlaceholder')}
                aria-invalid={submitted && errors.name}
                aria-describedby={describedBy(errors.name, 'name')}
                onChange={(event) => set('name', event.target.value)}
              />
              {fieldError(errors.name, 'name', t('form.nameRequired'))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-kind`}>{t('fields.kind')}</Label>
                <Select
                  value={state.kind}
                  onValueChange={(value) => set('kind', value as DealKind)}
                >
                  <SelectTrigger id={`${id}-kind`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEAL_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {t(`kinds.${kind}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!editing && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-stage`}>{t('fields.stage')}</Label>
                  <Select
                    value={state.stage}
                    onValueChange={(value) => set('stage', value as DealStage)}
                  >
                    <SelectTrigger
                      id={`${id}-stage`}
                      aria-describedby={state.stage === 'won' ? `${id}-won-note` : undefined}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DEAL_STAGES.map((stage) => (
                        <SelectItem key={stage} value={stage}>
                          {t(`stages.${stage}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {!editing && state.stage === 'won' && (
              <div
                id={`${id}-won-note`}
                className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
              >
                <p>
                  {lead
                    ? t('wonDialog.impact', { lead: lead.label })
                    : t('wonDialog.impactUnnamed')}
                </p>
                <p>{t('form.wonToday')}</p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-amount`}>{t('fields.amount')}</Label>
                <Input
                  id={`${id}-amount`}
                  inputMode="numeric"
                  value={state.amount}
                  aria-invalid={submitted && errors.amount}
                  aria-describedby={`${id}-amount-help ${describedBy(errors.amount, 'amount') ?? ''}`.trim()}
                  onChange={(event) => set('amount', event.target.value)}
                />
                <p id={`${id}-amount-help`} className="text-xs text-gray-500 dark:text-gray-400">
                  {t('form.amountHelp')}
                </p>
                {fieldError(errors.amount, 'amount', t('form.amountInvalid'))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-probability`}>{t('fields.probability')}</Label>
                <Input
                  id={`${id}-probability`}
                  inputMode="numeric"
                  value={state.probability}
                  aria-invalid={submitted && errors.probability}
                  aria-describedby={`${id}-probability-help ${describedBy(errors.probability, 'probability') ?? ''}`.trim()}
                  onChange={(event) => set('probability', event.target.value)}
                />
                <p
                  id={`${id}-probability-help`}
                  className="text-xs text-gray-500 dark:text-gray-400"
                >
                  {t('form.probabilityHelp', { value: STAGE_PROBABILITY[state.stage] })}
                </p>
                {fieldError(errors.probability, 'probability', t('form.probabilityInvalid'))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-close`}>{t('fields.expectedCloseOn')}</Label>
                <HearingDateInput
                  id={`${id}-close`}
                  label={t('fields.expectedCloseOn')}
                  value={state.expectedCloseOn}
                  onChange={(value) => set('expectedCloseOn', value)}
                  readOnly={false}
                  onInvalidChange={setCloseUnreadable}
                  error={
                    submitted && errors.expectedCloseOn && !closeUnreadable
                      ? t('form.closeDateInvalid')
                      : undefined
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-owner`}>{t('fields.owner')}</Label>
                <Select
                  value={
                    state.ownerUserId === undefined ? LEAD_ASSIGNEE : (state.ownerUserId ?? NONE)
                  }
                  onValueChange={(value) =>
                    set(
                      'ownerUserId',
                      value === LEAD_ASSIGNEE ? undefined : value === NONE ? null : value
                    )
                  }
                >
                  <SelectTrigger id={`${id}-owner`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {!editing && (
                      <SelectItem value={LEAD_ASSIGNEE}>{t('form.ownerFromLead')}</SelectItem>
                    )}
                    <SelectItem value={NONE}>{t('form.ownerNone')}</SelectItem>
                    {(members.data ?? []).map((member) => (
                      <SelectItem key={member.userId} value={member.userId}>
                        {member.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${id}-forecast`}>{t('fields.forecastCategory')}</Label>
              <Select
                value={state.forecastOverride ?? NONE}
                onValueChange={(value) =>
                  set('forecastOverride', value === NONE ? null : (value as ForecastOverride))
                }
              >
                <SelectTrigger id={`${id}-forecast`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {t('forecast.auto', { category: t(`forecast.${autoCategory}`) })}
                  </SelectItem>
                  {FORECAST_OVERRIDES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {t(`forecast.${category}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${id}-next`}>{t('fields.nextStep')}</Label>
              <Input
                id={`${id}-next`}
                value={state.nextStep}
                maxLength={DEAL_LIMITS.nextStep}
                onChange={(event) => set('nextStep', event.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {editing ? t('form.submitEdit') : t('form.submitCreate')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <LostReasonDialog
        open={lostOpen}
        onOpenChange={setLostOpen}
        dealName={state.name.trim()}
        pending={pending}
        onConfirm={(values) => save(values)}
      />
    </>
  );
}

/** Pick the lead of a new deal by company, name or email (the header search's suggestions) */
function LeadPicker({
  organizationId,
  inputId,
  value,
  onChange,
  error,
  describedBy,
}: {
  organizationId: string;
  inputId: string;
  value: { id: string; label: string } | null;
  onChange: (lead: { id: string; label: string } | null) => void;
  error: ReactNode;
  describedBy?: string;
}) {
  const t = useTranslations('deals');
  const [text, setText] = useState('');
  const query = text.trim();
  const suggestions = trpc.leadSearch.suggest.useQuery(
    { organizationId, query },
    { enabled: !value && query.length > 0, staleTime: 30 * 1000 }
  );

  if (value) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={inputId}>
          {t('form.lead')} <RequiredMark />
        </Label>
        <div className="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2 dark:border-gray-700">
          <span id={inputId} className="truncate text-sm">
            {value.label}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            {t('form.leadChange')}
          </Button>
        </div>
      </div>
    );
  }

  const items = suggestions.data ?? [];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>
        {t('form.lead')} <RequiredMark />
      </Label>
      <Input
        id={inputId}
        value={text}
        placeholder={t('form.leadPlaceholder')}
        autoComplete="off"
        aria-describedby={describedBy}
        onChange={(event) => setText(event.target.value)}
      />
      {query.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-700">
          {suggestions.isFetching && items.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">{t('form.leadSearching')}</li>
          ) : items.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">{t('form.leadNotFound')}</li>
          ) : (
            items.map((item) => {
              const label = [item.company, item.name].filter(Boolean).join(' ') || item.email;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none dark:hover:bg-gray-800 dark:focus-visible:bg-gray-800"
                    onClick={() => onChange({ id: item.id, label })}
                  >
                    <span className="font-medium">{label}</span>
                    <span className="text-xs text-gray-500">{item.email}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
      {error}
    </div>
  );
}

/** Marks a field that must be filled; part of its label, so it is read with the field's name */
function RequiredMark() {
  const t = useTranslations('deals.form');
  return (
    <span className="text-xs font-semibold text-red-600 dark:text-red-400">{t('required')}</span>
  );
}
