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
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { CONTACT_KIND_ICONS } from './contact-kinds';
import { fromJstInputValue, toJstInputValue } from './contact-time';
import { useRecordContact } from './use-record-contact';

/** Radix Select does not take an empty value: "no deal" is this one */
const NO_DEAL = 'none';

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

type Errors = Partial<Record<'when' | 'duration', string>>;

/**
 * Records a contact with its details (Refs #554): what it was (a call, an email, no answer, a
 * visit or an online meeting), when (now by default, never in the future), how long it took,
 * how it left the sale, the deal it was about and a note. A "no answer" takes no duration or
 * outcome. The deal list is the lead's deals; it is left out for those who may not read deals.
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
  const tContact = useTranslations('leadFollowUp.contact');
  const tOutcome = useTranslations('leadFollowUp.outcomes');
  const tStage = useTranslations('deals.stages');
  const tCommon = useTranslations('common');
  const id = useId();
  const { record, pending } = useRecordContact({ organizationId, leadId });

  const [kind, setKind] = useState<ContactKind>('call');
  const [when, setWhen] = useState('');
  const [whenTouched, setWhenTouched] = useState(false);
  const [duration, setDuration] = useState('');
  const [outcome, setOutcome] = useState<ContactOutcome | ''>('');
  const [dealId, setDealId] = useState<string>(NO_DEAL);
  const [dealTouched, setDealTouched] = useState(false);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const dealsQuery = trpc.deals.forLead.useQuery(
    { organizationId, leadId },
    { enabled: open && !!organizationId, retry: false }
  );
  // Open deals first; a closed one can still be named (a meeting after the order)
  const deals = useMemo(
    () =>
      [...(dealsQuery.data?.items ?? [])].sort(
        (a, b) => Number(isOpenStage(b.stage)) - Number(isOpenStage(a.stage))
      ),
    [dealsQuery.data]
  );

  useEffect(() => {
    if (!open) return;
    setKind('call');
    setWhen(toJstInputValue(new Date()));
    setWhenTouched(false);
    setDuration('');
    setOutcome('');
    setDealId(defaultDealId ?? NO_DEAL);
    setDealTouched(false);
    setNote('');
    setErrors({});
  }, [open, defaultDealId]);

  // Without a deal to start with, the lead's only open deal is the likely one
  useEffect(() => {
    if (!open || dealTouched || defaultDealId || !dealsQuery.data) return;
    const openDeals = dealsQuery.data.items.filter((deal) => isOpenStage(deal.stage));
    setDealId(openDeals.length === 1 ? openDeals[0].id : NO_DEAL);
  }, [open, dealTouched, defaultDealId, dealsQuery.data]);

  const reached = kind !== 'no_answer';

  const validate = (): { errors: Errors; contactedAt?: Date; durationMinutes: number | null } => {
    const found: Errors = {};
    let contactedAt: Date | undefined;
    if (whenTouched) {
      const parsed = fromJstInputValue(when);
      if (!parsed) found.when = t('whenInvalid');
      else if (parsed.getTime() > Date.now() + CONTACT_FUTURE_TOLERANCE_MS) {
        found.when = t('whenFuture');
      } else if (parsed.getTime() < CONTACT_EARLIEST_AT.getTime()) found.when = t('whenTooEarly');
      else contactedAt = parsed;
    }
    let durationMinutes: number | null = null;
    if (reached && duration.trim() !== '') {
      const minutes = Number(duration);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > CONTACT_DURATION_MAX_MINUTES) {
        found.duration = t('durationInvalid', { max: CONTACT_DURATION_MAX_MINUTES });
      } else durationMinutes = minutes;
    }
    return { errors: found, contactedAt, durationMinutes };
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = validate();
    setErrors(checked.errors);
    if (Object.keys(checked.errors).length > 0) return;
    record({
      kind,
      contactedAt: checked.contactedAt,
      durationMinutes: checked.durationMinutes,
      outcome: reached && outcome ? outcome : null,
      dealId: dealId === NO_DEAL ? null : dealId,
      note: note.trim() ? note : null,
    }).then(
      () => onOpenChange(false),
      // The hook has shown the error; the form keeps what was entered
      () => undefined
    );
  };

  const errorId = (field: keyof Errors) => (errors[field] ? `${id}-${field}-error` : undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description', { lead: leadLabel })}</DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{t('kind')}</legend>
            <ToggleGroup
              type="single"
              size="sm"
              value={kind}
              onValueChange={(value) => {
                if (value) setKind(value as ContactKind);
              }}
              aria-label={t('kind')}
              className="flex-wrap justify-start"
            >
              {CONTACT_KINDS.map((value) => {
                const Icon = CONTACT_KIND_ICONS[value];
                return (
                  <ToggleGroupItem key={value} value={value} className="gap-1">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {tContact(`kinds.${value}`)}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-when`}>{t('when')}</Label>
            <Input
              id={`${id}-when`}
              type="datetime-local"
              value={when}
              max={toJstInputValue(new Date())}
              aria-invalid={!!errors.when}
              aria-describedby={errorId('when') ?? `${id}-when-help`}
              onChange={(event) => {
                setWhen(event.target.value);
                setWhenTouched(true);
                setErrors((current) => ({ ...current, when: undefined }));
              }}
            />
            {errors.when ? (
              <p id={errorId('when')} className="text-sm text-red-600 dark:text-red-400">
                {errors.when}
              </p>
            ) : (
              <p id={`${id}-when-help`} className="text-xs text-muted-foreground">
                {t('whenHelp')}
              </p>
            )}
          </div>

          {reached ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-duration`}>{t('duration')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`${id}-duration`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={CONTACT_DURATION_MAX_MINUTES}
                    step={1}
                    value={duration}
                    className="w-28"
                    aria-invalid={!!errors.duration}
                    aria-describedby={errorId('duration')}
                    onChange={(event) => {
                      setDuration(event.target.value);
                      setErrors((current) => ({ ...current, duration: undefined }));
                    }}
                  />
                  <span className="text-sm text-muted-foreground">{t('minutes')}</span>
                </div>
                {errors.duration && (
                  <p id={errorId('duration')} className="text-sm text-red-600 dark:text-red-400">
                    {errors.duration}
                  </p>
                )}
              </div>

              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">{t('outcome')}</legend>
                <ToggleGroup
                  type="single"
                  size="sm"
                  value={outcome}
                  onValueChange={(value) => setOutcome(value as ContactOutcome | '')}
                  aria-label={t('outcome')}
                  className="flex-wrap justify-start"
                >
                  {CONTACT_OUTCOMES.map((value) => (
                    <ToggleGroupItem key={value} value={value}>
                      {tOutcome(value)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </fieldset>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noAnswerHelp')}</p>
          )}

          {deals.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-deal`}>{t('deal')}</Label>
              <Select
                value={dealId}
                onValueChange={(value) => {
                  setDealId(value);
                  setDealTouched(true);
                }}
              >
                <SelectTrigger id={`${id}-deal`}>
                  <SelectValue />
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
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('saving') : tContact('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
