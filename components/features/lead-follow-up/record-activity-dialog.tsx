'use client';

import { SEND_SHORTCUTS, TOGGLE_ITEM, isSendShortcut } from '@/components/common/form-controls';
import { TAP_TARGET } from '@/components/common/tap-target';
import { parseWhole } from '@/components/features/deals/deal-format';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { isOpenStage } from '@/lib/features/deals/types/pipeline';
import {
  CONTACT_DURATION_MAX_MINUTES,
  CONTACT_EARLIEST_AT,
  CONTACT_FUTURE_TOLERANCE_MS,
  CONTACT_KINDS,
  CONTACT_NOTE_MAX,
  CONTACT_OUTCOMES,
  type ContactKind,
  type ContactOutcome,
} from '@/lib/features/lead-follow-up/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { useNow, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CONTACT_KIND_ICONS } from './contact-kinds';
import { fromJstInputValue, toJstInputValue } from './contact-time';
import { useRecordContact } from './use-record-contact';

/** Radix Select does not take an empty value: "no deal" is this one */
const NO_DEAL = 'none';

/** Inputs are 44px tall on phones (#196), like the hearing date inputs */
const FIELD_HEIGHT = 'h-11 sm:h-10';

export interface RecordActivityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  leadId: string;
  /** Whom it is for, in the description */
  leadLabel: string;
  /** The deal to start with (the deal page); otherwise the lead's only open deal, if any */
  defaultDealId?: string;
}

type Field = 'kind' | 'when' | 'duration';

/**
 * Records a contact with its details (Refs #554): what it was (a call, an email, a visit, an
 * online meeting or no answer; chosen each time, as a record cannot be corrected later), when
 * (now by default, never in the future), how long it took, how it left the sale, the deal it
 * was about and a note. A "no answer" takes no duration or outcome. The deal list is the lead's
 * deals; it is left out for those who may not read deals.
 */
export function RecordActivityDialog({
  open,
  onOpenChange,
  organizationId,
  leadId,
  leadLabel,
  defaultDealId,
}: RecordActivityDialogProps) {
  const t = useTranslations('leadFollowUp.activity');
  const recorder = useRecordContact({ organizationId, leadId, toastOnError: false });
  const dirty = useRef(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Not closed while it is being saved, so a failure can still be told
        if (!next && recorder.pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex max-h-[90dvh] flex-col gap-0 p-0 sm:max-w-lg"
        onInteractOutside={(event) => {
          // A tap outside does not throw away what was entered
          if (dirty.current || recorder.pending) event.preventDefault();
        }}
      >
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { lead: leadLabel })}</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so every opening starts empty at the current time */}
        <RecordActivityForm
          organizationId={organizationId}
          leadId={leadId}
          defaultDealId={defaultDealId}
          recorder={recorder}
          onDirtyChange={(value) => {
            dirty.current = value;
          }}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function RecordActivityForm({
  organizationId,
  leadId,
  defaultDealId,
  recorder: { record, pending },
  onDirtyChange,
  onDone,
}: {
  organizationId: string;
  leadId: string;
  defaultDealId?: string;
  recorder: ReturnType<typeof useRecordContact>;
  onDirtyChange: (dirty: boolean) => void;
  onDone: () => void;
}) {
  const t = useTranslations('leadFollowUp.activity');
  const tContact = useTranslations('leadFollowUp.contact');
  const tOutcome = useTranslations('leadFollowUp.outcomes');
  const tStage = useTranslations('deals.stages');
  const tCommon = useTranslations('common');
  const id = useId();
  // The shown time follows the clock until it is changed, so what is saved is what was shown
  const now = useNow({ updateInterval: 30_000 });

  const [kind, setKind] = useState<ContactKind | null>(null);
  const [when, setWhen] = useState('');
  const [whenTouched, setWhenTouched] = useState(false);
  const [duration, setDuration] = useState('');
  const [outcome, setOutcome] = useState<ContactOutcome | ''>('');
  const [dealId, setDealId] = useState<string>(defaultDealId ?? NO_DEAL);
  const [dealTouched, setDealTouched] = useState(false);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const kindRef = useRef<HTMLDivElement>(null);
  const whenRef = useRef<HTMLInputElement>(null);
  const durationRef = useRef<HTMLInputElement>(null);

  const dealsQuery = trpc.deals.forLead.useQuery(
    { organizationId, leadId },
    { enabled: !!organizationId, retry: false }
  );
  const dealsForbidden = dealsQuery.error?.data?.code === 'FORBIDDEN';
  // Open deals first; a closed one can still be named (a meeting after the order)
  const deals = useMemo(
    () =>
      [...(dealsQuery.data?.items ?? [])].sort(
        (a, b) => Number(isOpenStage(b.stage)) - Number(isOpenStage(a.stage))
      ),
    [dealsQuery.data]
  );

  // Without a deal to start with, the lead's only open deal is the likely one
  useEffect(() => {
    if (dealTouched || defaultDealId || !dealsQuery.data) return;
    const openDeals = dealsQuery.data.items.filter((deal) => isOpenStage(deal.stage));
    setDealId(openDeals.length === 1 ? openDeals[0].id : NO_DEAL);
  }, [dealTouched, defaultDealId, dealsQuery.data]);

  const reached = kind !== 'no_answer';
  const shownWhen = whenTouched ? when : toJstInputValue(now);

  const check = () => {
    const errors: Partial<Record<Field, string>> = {};
    if (!kind) errors.kind = t('kindRequired');
    let contactedAt: Date | undefined;
    if (whenTouched) {
      const parsed = fromJstInputValue(when);
      if (!parsed) errors.when = t('whenInvalid');
      else if (parsed.getTime() > Date.now() + CONTACT_FUTURE_TOLERANCE_MS) {
        errors.when = t('whenFuture');
      } else if (parsed.getTime() < CONTACT_EARLIEST_AT.getTime()) errors.when = t('whenTooEarly');
      else contactedAt = parsed;
    }
    let durationMinutes: number | null = null;
    if (reached) {
      const minutes = parseWhole(duration.normalize('NFKC'), CONTACT_DURATION_MAX_MINUTES);
      if (minutes === 'invalid' || minutes === 0) {
        errors.duration = t('durationInvalid', { max: CONTACT_DURATION_MAX_MINUTES });
      } else durationMinutes = minutes;
    }
    return { errors, contactedAt, durationMinutes };
  };
  // Once sent, the fields are checked again as they change
  const errors = submitted ? check().errors : {};

  const dirty =
    kind !== null || whenTouched || duration.trim() !== '' || outcome !== '' || note.trim() !== '';
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (pending || !kind) {
      if (!kind) {
        setSubmitted(true);
        kindRef.current?.querySelector('button')?.focus();
      }
      return;
    }
    setSubmitted(true);
    setSaveFailed(false);
    const checked = check();
    if (checked.errors.when) return whenRef.current?.focus();
    if (checked.errors.duration) return durationRef.current?.focus();
    record({
      kind,
      contactedAt: checked.contactedAt,
      durationMinutes: checked.durationMinutes,
      outcome: reached && outcome ? outcome : null,
      dealId: dealId === NO_DEAL ? null : dealId,
      note: note.trim() ? note : null,
    }).then(
      () => onDone(),
      // The form keeps what was entered and says so in place
      () => setSaveFailed(true)
    );
  };

  const describedBy = (...ids: (string | false | undefined)[]) =>
    ids.filter(Boolean).join(' ') || undefined;
  const errorText = (field: Field) =>
    errors[field] ? (
      <p id={`${id}-${field}-error`} className="text-sm text-red-700 dark:text-red-400">
        {errors[field]}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
        <fieldset
          className="space-y-1.5"
          aria-describedby={describedBy(errors.kind && `${id}-kind-error`)}
        >
          <legend className="flex items-center gap-2 text-sm font-medium">
            {t('kind')}
            <span className="text-xs font-semibold text-red-600 dark:text-red-400">
              {t('required')}
            </span>
          </legend>
          <ToggleGroup
            ref={kindRef}
            type="single"
            size="sm"
            variant="outline"
            value={kind ?? ''}
            onValueChange={(value) => {
              if (value) setKind(value as ContactKind);
            }}
            className="flex-wrap justify-start"
          >
            {CONTACT_KINDS.map((value) => {
              const Icon = CONTACT_KIND_ICONS[value];
              return (
                <ToggleGroupItem key={value} value={value} className={TOGGLE_ITEM}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {t(`kinds.${value}`)}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
          {errorText('kind')}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-when`}>{t('when')}</Label>
            <Input
              ref={whenRef}
              id={`${id}-when`}
              type="datetime-local"
              className={FIELD_HEIGHT}
              value={shownWhen}
              min={toJstInputValue(CONTACT_EARLIEST_AT)}
              max={toJstInputValue(now)}
              aria-invalid={!!errors.when}
              aria-describedby={describedBy(`${id}-when-help`, errors.when && `${id}-when-error`)}
              onChange={(event) => {
                setWhen(event.target.value);
                setWhenTouched(true);
              }}
            />
            <p id={`${id}-when-help`} className="text-sm text-muted-foreground">
              {t('whenHelp')}
            </p>
            {errorText('when')}
          </div>

          {reached && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-duration`}>{t('duration')}</Label>
              <Input
                ref={durationRef}
                id={`${id}-duration`}
                inputMode="numeric"
                autoComplete="off"
                value={duration}
                className={cn(FIELD_HEIGHT, 'sm:w-32')}
                aria-invalid={!!errors.duration}
                aria-describedby={describedBy(errors.duration && `${id}-duration-error`)}
                onChange={(event) => setDuration(event.target.value)}
              />
              {errorText('duration')}
            </div>
          )}
        </div>

        {reached ? (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{t('outcome')}</legend>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={outcome}
              onValueChange={(value) => setOutcome(value as ContactOutcome | '')}
              className="flex-wrap justify-start"
            >
              {CONTACT_OUTCOMES.map((value) => (
                <ToggleGroupItem key={value} value={value} className={TOGGLE_ITEM}>
                  {tOutcome(value)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </fieldset>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noAnswerHelp')}</p>
        )}

        {!dealsForbidden && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-deal`}>{t('deal')}</Label>
            {dealsQuery.isError ? (
              <p className="text-sm text-muted-foreground">{t('dealLoadError')}</p>
            ) : (
              <Select
                value={dealId}
                disabled={!dealsQuery.data || deals.length === 0}
                onValueChange={(value) => {
                  // Radix's hidden native select of a form can report '' while the options
                  // register; "no deal" is NO_DEAL, never ''
                  if (!value) return;
                  setDealId(value);
                  setDealTouched(true);
                }}
              >
                <SelectTrigger id={`${id}-deal`} className={FIELD_HEIGHT}>
                  {!dealsQuery.data ? (
                    <span className="text-muted-foreground">{t('dealLoading')}</span>
                  ) : deals.length === 0 ? (
                    <span className="text-muted-foreground">{t('dealNoDeals')}</span>
                  ) : (
                    <SelectValue />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEAL}>{t('dealNone')}</SelectItem>
                  {deals.map((deal) => (
                    <SelectItem key={deal.id} value={deal.id}>
                      {t('dealOption', { name: deal.name, stage: tStage(deal.stage) })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-note`}>{tContact('note')}</Label>
          <Textarea
            id={`${id}-note`}
            value={note}
            maxLength={CONTACT_NOTE_MAX}
            rows={3}
            placeholder={t('notePlaceholder')}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              // Ctrl/⌘ + Enter records from the note; not the Enter of a conversion
              if (isSendShortcut(event)) {
                event.preventDefault();
                submit();
              }
            }}
            aria-keyshortcuts={SEND_SHORTCUTS}
          />
        </div>
      </div>

      {/* Always visible, so a long form on a phone never hides the button */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-background px-6 py-3">
        {saveFailed && (
          <p role="alert" className="mr-auto text-sm text-red-700 dark:text-red-400">
            {tContact('error')}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          className={TAP_TARGET}
          disabled={pending}
          onClick={onDone}
        >
          {tCommon('cancel')}
        </Button>
        <Button type="submit" className={cn(TAP_TARGET, 'min-w-24')} disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {pending ? t('saving') : tContact('save')}
        </Button>
      </div>
    </form>
  );
}
