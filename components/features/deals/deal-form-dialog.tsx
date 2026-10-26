'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { HearingDateInput } from '@/components/features/lead-hearings/hearing-date-inputs';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { DealView } from '@/lib/features/deals/service';
import {
  DEAL_KINDS,
  DEAL_LOST_REASONS,
  DEAL_STAGES,
  type DealKind,
  type DealLostReason,
  type DealStage,
  FORECAST_OVERRIDES,
  type ForecastOverride,
  STAGE_PROBABILITY,
  dealLostReasonEnum,
  forecastCategory,
  isOpenStage,
} from '@/lib/features/deals/types/pipeline';
import { DEAL_LIMITS } from '@/lib/features/deals/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { ChevronsUpDown, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { DealAmountInput } from './deal-amount-input';
import { isDealDate, parseAmount, parseWhole } from './deal-format';
import { LostReasonDialog, type LostValues } from './lost-reason-dialog';
import { RequiredMark } from './required-mark';
import { useDealMutations } from './use-deal-mutations';

/** Select value for "nobody" / "automatic" (Radix needs non-empty values) */
const NONE = '__none__';
/** Select value of a new deal's owner left to the server (the lead's assignee) */
const LEAD_ASSIGNEE = '__lead__';
/** Wait after typing before the lead suggestions are read */
const LEAD_SEARCH_DEBOUNCE_MS = 200;

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
  /** A won or lost deal's day, reason, details and competitor (Refs #720) */
  closedOn: string | undefined;
  lostReason: DealLostReason | '';
  lostNote: string;
  competitor: string;
}

const emptyState = (deal?: DealView): FormState => {
  // A reason a deal can no longer take (保留, #445) is not chosen
  const lostReason = dealLostReasonEnum.safeParse(deal?.lostReason);
  return {
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
    closedOn: deal?.closedOn ?? undefined,
    lostReason: lostReason.success ? lostReason.data : '',
    lostNote: deal?.lostNote ?? '',
    competitor: deal?.competitor ?? '',
  };
};

/** The fields the form can send */
interface SentFields {
  name: string;
  kind: DealKind;
  amount: number | null;
  probability: number;
  forecastOverride: ForecastOverride | null;
  expectedCloseOn: string | null;
  nextStep: string | null;
  ownerUserId: string | null;
  closedOn: string;
  lostReason: DealLostReason;
  lostNote: string | null;
  competitor: string | null;
}
/** Every deal sends these; the others depend on the deal */
type FormValues = Pick<SentFields, 'name' | 'kind' | 'amount' | 'expectedCloseOn' | 'nextStep'> &
  Partial<SentFields>;

/**
 * What the form sends. An open deal sends its probability (left out when empty: the stage's) and
 * forecast category; a won or lost deal, whose probability and category follow its stage, sends
 * its day, its lost reason and details, and the competitor instead (Refs #720). An owner left to
 * the server is not sent.
 */
function formValues(form: FormState, closed: 'won' | 'lost' | null): FormValues {
  const amount = parseAmount(form.amount);
  const values: FormValues = {
    name: form.name.trim(),
    kind: form.kind,
    amount: amount === 'invalid' ? null : amount,
    expectedCloseOn: form.expectedCloseOn ?? null,
    nextStep: form.nextStep.trim() || null,
    ...(form.ownerUserId !== undefined ? { ownerUserId: form.ownerUserId } : {}),
  };
  if (closed) {
    return {
      ...values,
      ...(form.closedOn ? { closedOn: form.closedOn } : {}),
      competitor: form.competitor.trim() || null,
      ...(closed === 'lost'
        ? {
            ...(form.lostReason ? { lostReason: form.lostReason } : {}),
            lostNote: form.lostNote.trim() || null,
          }
        : {}),
    };
  }
  const probability = parseWhole(form.probability, 100);
  return {
    ...values,
    forecastOverride: form.forecastOverride,
    ...(typeof probability === 'number' ? { probability } : {}),
  };
}

/** The values that differ from those the form was opened with */
function changedValues(values: FormValues, opened: FormValues): Partial<SentFields> {
  const changed: Partial<SentFields> = {};
  const copy = <K extends keyof SentFields>(key: K) => {
    if (values[key] !== opened[key]) changed[key] = values[key];
  };
  for (const key of Object.keys(values) as (keyof SentFields)[]) copy(key);
  return changed;
}

/** The fields that can hold an error, in the order the form shows them, with their boxes' ids */
const ERROR_FIELDS = [
  ['lead', 'lead'],
  ['name', 'name'],
  ['closedOn', 'closed'],
  ['lostReason', 'lost-reason'],
  ['amount', 'amount'],
  ['probability', 'probability'],
  ['expectedCloseOn', 'close'],
] as const;
type ErrorField = (typeof ERROR_FIELDS)[number][0];

/**
 * Create a deal for a lead, or edit one (Refs #436). The stage of an existing deal is changed
 * on the board or the deal page; creating one directly as lost asks for the lost reason, and as
 * won says what it does to the lead. Editing sends only the fields changed in the dialog, so it
 * does not write back a value changed elsewhere meanwhile (a stage move resets the probability).
 * A save that fails says so in the dialog, which does not close while it saves, and a send with
 * errors takes the focus to the first field to fix (#720). The fields scroll, and the buttons
 * stay in view under them.
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
  const tReason = useTranslations('pipeline.lostReason');
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const editing = !!deal;
  const closed = deal && !isOpenStage(deal.stage) ? deal.stage : null;
  const [state, setState] = useState<FormState>(() => emptyState(deal));
  // The values the dialog was opened with, which editing compares against
  const [initial, setInitial] = useState<FormState>(() => emptyState(deal));
  const [lead, setLead] = useState<{ id: string; label: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  // A send with errors: the focus goes to the first one once they are shown
  const [focusRequest, setFocusRequest] = useState(0);
  // The date boxes hold text that is not a date (they show their own error)
  const [closeUnreadable, setCloseUnreadable] = useState(false);
  const [closedOnUnreadable, setClosedOnUnreadable] = useState(false);
  const { create, update } = useDealMutations({ toastErrors: false });
  const members = trpc.leads.assignees.useQuery({ organizationId }, { enabled: open });

  useEffect(() => {
    if (!open) return;
    const opened = emptyState(deal);
    setState(opened);
    setInitial(opened);
    setLead(null);
    setSubmitted(false);
    setSaveFailed(false);
  }, [open, deal]);

  // The date boxes are mounted anew, without typed text, each time the dialog opens
  useEffect(() => {
    if (!open) return;
    setCloseUnreadable(false);
    setClosedOnUnreadable(false);
  }, [open]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((current) => ({ ...current, [key]: value }));

  const amount = parseAmount(state.amount);
  const probability = parseWhole(state.probability, 100);
  const chosenLeadId = leadId ?? lead?.id;
  const errors: Record<ErrorField, boolean> = {
    lead: !editing && !chosenLeadId,
    name: state.name.trim() === '',
    // A day the deals do not take (outside 2000-2100) is refused by the API too
    closedOn:
      closed !== null && (closedOnUnreadable || !state.closedOn || !isDealDate(state.closedOn)),
    lostReason: closed === 'lost' && state.lostReason === '',
    amount: amount === 'invalid',
    probability: closed === null && probability === 'invalid',
    expectedCloseOn:
      closeUnreadable || (!!state.expectedCloseOn && !isDealDate(state.expectedCloseOn)),
  };
  const firstError = ERROR_FIELDS.find(([field]) => errors[field]);
  const pending = create.isPending || update.isPending;
  // What must be filled in this dialog, for its description
  const requiredHelp = t(`form.requiredHelp.${closed ?? (!editing && !leadId ? 'lead' : 'name')}`);
  // A lost deal saved with 保留 before it was no deal's reason (#445) asks for another one
  const onHold = closed === 'lost' && deal?.lostReason === 'on_hold' && state.lostReason === '';
  const autoCategory = forecastCategory({
    stage: state.stage,
    probability: typeof probability === 'number' ? probability : STAGE_PROBABILITY[state.stage],
    forecastOverride: null,
  });

  // After the errors are on the page, so the first field is read with its error
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs for each send with errors
  useEffect(() => {
    if (focusRequest === 0 || !firstError) return;
    document.getElementById(`${id}-${firstError[1]}`)?.focus();
  }, [focusRequest]);

  const save = (lost?: LostValues) => {
    const done = (saved: DealView) => {
      setLostOpen(false);
      onOpenChange(false);
      onSaved?.(saved);
    };
    const failed = () => setSaveFailed(true);
    if (deal) {
      const changed = changedValues(formValues(state, closed), formValues(initial, closed));
      if (Object.keys(changed).length === 0) {
        onOpenChange(false);
        return;
      }
      update.mutate(
        { organizationId, dealId: deal.id, ...changed },
        { onSuccess: done, onError: failed }
      );
    } else if (chosenLeadId) {
      create.mutate(
        {
          organizationId,
          leadId: chosenLeadId,
          stage: state.stage,
          ...formValues(state, null),
          ...lost,
        },
        { onSuccess: done, onError: failed }
      );
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setSaveFailed(false);
    if (firstError) {
      setFocusRequest((count) => count + 1);
      return;
    }
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
  const closedOnLabel = t(closed === 'lost' ? 'fields.lostOn' : 'fields.wonOn');

  return (
    <>
      <Dialog
        open={open && !lostOpen}
        onOpenChange={(next) => {
          // Not closed while it is saved, so a failure can still be told
          if (!next && pending) return;
          onOpenChange(next);
        }}
      >
        <DialogContent
          className="flex max-h-[90dvh] flex-col gap-0 p-0 sm:max-w-lg"
          onInteractOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <DialogHeader className="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
            <DialogTitle>{editing ? t('form.editTitle') : t('form.createTitle')}</DialogTitle>
            <DialogDescription className="sr-only">{requiredHelp}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
              {!editing && !leadId && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-lead`}>
                    {t('form.lead')} <RequiredMark />
                  </Label>
                  <LeadCombobox
                    organizationId={organizationId}
                    triggerId={`${id}-lead`}
                    value={lead}
                    onChange={setLead}
                    onPicked={() => nameRef.current?.focus()}
                    invalid={submitted && errors.lead}
                    describedBy={describedBy(errors.lead, 'lead')}
                  />
                  {fieldError(errors.lead, 'lead', t('form.leadRequired'))}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor={`${id}-name`}>
                  {t('fields.name')} <RequiredMark />
                </Label>
                <Input
                  ref={nameRef}
                  id={`${id}-name`}
                  value={state.name}
                  maxLength={DEAL_LIMITS.name}
                  placeholder={t('form.namePlaceholder')}
                  aria-invalid={submitted && errors.name}
                  aria-describedby={describedBy(errors.name, 'name')}
                  className={TAP_TARGET}
                  onChange={(event) => set('name', event.target.value)}
                />
                {fieldError(errors.name, 'name', t('form.nameRequired'))}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-kind`}>{t('fields.kind')}</Label>
                  <Select
                    value={state.kind}
                    onValueChange={(value) => {
                      // A form's reset or autofill clears Radix's hidden select: keep the choice
                      if (!value) return;
                      set('kind', value as DealKind);
                    }}
                  >
                    <SelectTrigger id={`${id}-kind`} className={TAP_TARGET}>
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
                      onValueChange={(value) => {
                        if (!value) return;
                        set('stage', value as DealStage);
                      }}
                    >
                      <SelectTrigger
                        id={`${id}-stage`}
                        className={TAP_TARGET}
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
                  <p>{t('form.wonPast')}</p>
                </div>
              )}

              {closed && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`${id}-closed`}>
                        {closedOnLabel} <RequiredMark />
                      </Label>
                      <HearingDateInput
                        id={`${id}-closed`}
                        label={closedOnLabel}
                        value={state.closedOn}
                        onChange={(value) => set('closedOn', value)}
                        readOnly={false}
                        clearable={false}
                        onInvalidChange={setClosedOnUnreadable}
                        error={
                          submitted && errors.closedOn && !closedOnUnreadable
                            ? t(closed === 'lost' ? 'form.lostOnInvalid' : 'form.wonOnInvalid')
                            : undefined
                        }
                      />
                    </div>
                    {closed === 'lost' && (
                      <div className="space-y-1.5">
                        <Label htmlFor={`${id}-lost-reason`}>
                          {t('fields.lostReason')} <RequiredMark />
                        </Label>
                        <Select
                          value={state.lostReason}
                          onValueChange={(value) => {
                            if (!value) return;
                            set('lostReason', value as DealLostReason);
                          }}
                        >
                          <SelectTrigger
                            id={`${id}-lost-reason`}
                            className={TAP_TARGET}
                            aria-invalid={submitted && errors.lostReason}
                            aria-describedby={
                              [
                                onHold ? `${id}-on-hold` : null,
                                describedBy(errors.lostReason, 'lost-reason'),
                              ]
                                .filter(Boolean)
                                .join(' ') || undefined
                            }
                          >
                            <SelectValue placeholder={t('lostDialog.reasonPlaceholder')} />
                          </SelectTrigger>
                          <SelectContent>
                            {DEAL_LOST_REASONS.map((reason) => (
                              <SelectItem key={reason} value={reason}>
                                {tReason(reason)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {onHold && (
                          <p
                            id={`${id}-on-hold`}
                            className="text-sm text-amber-800 dark:text-amber-300"
                          >
                            {t('form.onHoldReason', { reason: tReason('on_hold') })}
                          </p>
                        )}
                        {fieldError(
                          errors.lostReason,
                          'lost-reason',
                          t('lostDialog.reasonRequired')
                        )}
                      </div>
                    )}
                  </div>
                  {closed === 'lost' && (
                    <div className="space-y-1.5">
                      <Label htmlFor={`${id}-lost-note`}>{t('fields.lostNote')}</Label>
                      <Textarea
                        id={`${id}-lost-note`}
                        value={state.lostNote}
                        maxLength={DEAL_LIMITS.lostNote}
                        rows={3}
                        onChange={(event) => set('lostNote', event.target.value)}
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id}-competitor`}>{t('fields.competitor')}</Label>
                    <Input
                      id={`${id}-competitor`}
                      value={state.competitor}
                      maxLength={DEAL_LIMITS.competitor}
                      className={TAP_TARGET}
                      onChange={(event) => set('competitor', event.target.value)}
                    />
                  </div>
                </>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-amount`}>{t('fields.amount')}</Label>
                  <DealAmountInput
                    id={`${id}-amount`}
                    value={state.amount}
                    onChange={(value) => set('amount', value)}
                    showError={submitted}
                  />
                </div>
                {!closed && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id}-probability`}>{t('fields.probability')}</Label>
                    <Input
                      id={`${id}-probability`}
                      inputMode="numeric"
                      value={state.probability}
                      aria-invalid={submitted && errors.probability}
                      aria-describedby={`${id}-probability-help ${describedBy(errors.probability, 'probability') ?? ''}`.trim()}
                      className={TAP_TARGET}
                      onChange={(event) => set('probability', event.target.value)}
                    />
                    <p
                      id={`${id}-probability-help`}
                      className="text-sm text-gray-600 dark:text-gray-300"
                    >
                      {t('form.probabilityHelp', { value: STAGE_PROBABILITY[state.stage] })}
                    </p>
                    {fieldError(errors.probability, 'probability', t('form.probabilityInvalid'))}
                  </div>
                )}
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
                    onValueChange={(value) => {
                      if (!value) return;
                      set(
                        'ownerUserId',
                        value === LEAD_ASSIGNEE ? undefined : value === NONE ? null : value
                      );
                    }}
                  >
                    <SelectTrigger id={`${id}-owner`} className={TAP_TARGET}>
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

              {!closed && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-forecast`}>{t('fields.forecastCategory')}</Label>
                  <Select
                    value={state.forecastOverride ?? NONE}
                    onValueChange={(value) => {
                      if (!value) return;
                      set('forecastOverride', value === NONE ? null : (value as ForecastOverride));
                    }}
                  >
                    <SelectTrigger id={`${id}-forecast`} className={TAP_TARGET}>
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
              )}

              <div className="space-y-1.5">
                <Label htmlFor={`${id}-next`}>{t('fields.nextStep')}</Label>
                <Input
                  id={`${id}-next`}
                  value={state.nextStep}
                  maxLength={DEAL_LIMITS.nextStep}
                  className={TAP_TARGET}
                  onChange={(event) => set('nextStep', event.target.value)}
                />
              </div>
            </div>

            {/* Always in view, so a long form on a phone never hides the buttons or a failure */}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 px-6 py-3 dark:border-gray-700">
              {saveFailed && (
                <p role="alert" className="mr-auto text-sm text-red-700 dark:text-red-400">
                  {t('form.saveError')}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                className={TAP_TARGET}
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                {tCommon('cancel')}
              </Button>
              <Button type="submit" className={cn(TAP_TARGET, 'min-w-24')} disabled={pending}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {pending
                  ? t('form.saving')
                  : editing
                    ? t('form.submitEdit')
                    : t('form.submitCreate')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <LostReasonDialog
        open={lostOpen}
        onOpenChange={setLostOpen}
        dealName={state.name.trim()}
        pending={pending}
        error={saveFailed ? t('form.saveError') : null}
        onConfirm={(values) => {
          setSaveFailed(false);
          save(values);
        }}
      />
    </>
  );
}

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * The lead of a new deal (Refs #720): a combobox that searches the organization's leads by
 * company, name or email (the header search's suggestions). Choosing one takes the focus to the
 * deal's name, the next thing to fill in. A status line, always there, reads out what the list
 * shows (how many suggestions, or why none). The list is modal, so it scrolls inside the dialog
 * (the shadcn Popover in a Dialog).
 */
function LeadCombobox({
  organizationId,
  triggerId,
  value,
  onChange,
  onPicked,
  invalid,
  describedBy,
}: {
  organizationId: string;
  triggerId: string;
  value: { id: string; label: string } | null;
  onChange: (lead: { id: string; label: string }) => void;
  /** Called once the list has closed after a choice */
  onPicked: () => void;
  invalid: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('deals.form');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const typed = text.trim();
  const query = useDebounced(typed, LEAD_SEARCH_DEBOUNCE_MS);
  // Set by a choice, so closing the list gives the focus to the name instead of the button
  const picked = useRef(false);
  const suggestions = trpc.leadSearch.suggest.useQuery(
    { organizationId, query },
    { enabled: open && query.length > 0, staleTime: 30 * 1000 }
  );
  const items = query.length > 0 ? (suggestions.data ?? []) : [];
  const searching = typed !== query || suggestions.isFetching;
  // Why the list has no suggestions, shown in it; null while it has some
  const empty =
    typed.length === 0
      ? t('leadTypeToSearch')
      : items.length > 0
        ? null
        : searching
          ? t('leadSearching')
          : t('leadNotFound');

  return (
    <Popover
      modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setText('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={triggerId}
          type="button"
          variant="outline"
          // biome-ignore lint/a11y/useSemanticElements: documented shadcn combobox pattern (Popover trigger Button with role combobox)
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={cn('w-full justify-between px-3 font-normal', TAP_TARGET)}
        >
          <span className={cn('truncate', !value && 'text-gray-600 dark:text-gray-300')}>
            {value ? value.label : t('leadChoose')}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0"
        onCloseAutoFocus={(event) => {
          if (!picked.current) return;
          picked.current = false;
          event.preventDefault();
          onPicked();
        }}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: live-region notice, not a form output */}
        <p role="status" className="sr-only">
          {empty ?? t('leadCount', { count: items.length })}
        </p>
        <Command shouldFilter={false} label={t('leadSearchLabel')}>
          <CommandInput value={text} onValueChange={setText} placeholder={t('leadPlaceholder')} />
          <CommandList>
            {empty !== null ? (
              // Read out by the status line
              <p aria-hidden="true" className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
                {empty}
              </p>
            ) : (
              <CommandGroup>
                {items.map((item) => {
                  const label = [item.company, item.name].filter(Boolean).join(' ') || item.email;
                  return (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      className={cn('flex-col items-start gap-0', TAP_TARGET)}
                      onSelect={() => {
                        picked.current = true;
                        onChange({ id: item.id, label });
                        setOpen(false);
                        setText('');
                      }}
                    >
                      <span className="font-medium">{label}</span>
                      <span className="text-sm text-gray-600 dark:text-gray-300">{item.email}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
