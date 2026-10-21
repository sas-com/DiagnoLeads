'use client';

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
import { TARGET_SYSTEMS } from '@/lib/features/leads/types/pipeline';
import {
  PROSPECT_ENTRIES,
  PROSPECT_NEXT_STEPS,
  PROSPECT_REACTIONS,
  PROSPECT_STAGES,
  PROSPECT_SUPPORT_END,
  PROSPECT_SYSTEM_SCOPES,
  PROSPECT_TROUBLES,
} from '@/lib/features/prospects/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ProspectRow } from './types';

const NONE = '__none__';
/** Chips: a border while not picked, filled with the brand colour once picked */
const CHIP =
  'min-h-9 border border-gray-300 px-3 data-[state=on]:border-transparent data-[state=on]:hover:bg-brand-600 data-[state=on]:hover:text-white dark:border-gray-600';

interface FormState {
  contactedOn: string;
  entry: string;
  company: string;
  department: string;
  jobTitle: string;
  surname: string;
  explainedOn: string;
  heard: string;
  systemScope: string;
  targetSystem: string;
  supportEndSoon: string;
  troubles: string[];
  reaction: string;
  nextStep: string;
  nextActionOn: string;
  nextActionNote: string;
  stage: string;
  meetingOn: string;
  salesUserId: string;
  remarks: string;
}
type TextKey = Exclude<keyof FormState, 'troubles'>;
type RequiredKey = 'contactedOn' | 'entry' | 'company';

const toForm = (row: ProspectRow | null, today: string): FormState => ({
  contactedOn: row?.contactedOn ?? today,
  entry: row?.entry ?? '',
  company: row?.company ?? '',
  department: row?.department ?? '',
  jobTitle: row?.jobTitle ?? '',
  surname: row?.surname ?? '',
  explainedOn: row?.explainedOn ?? '',
  heard: row?.heard ?? '',
  systemScope: row?.systemScope ?? '',
  targetSystem: row?.targetSystem ?? '',
  supportEndSoon: row?.supportEndSoon ?? '',
  troubles: row?.troubles ?? [],
  reaction: row?.reaction ?? '',
  nextStep: row?.nextStep ?? '',
  nextActionOn: row?.nextActionOn ?? '',
  nextActionNote: row?.nextActionNote ?? '',
  stage: row?.stage ?? '',
  meetingOn: row?.meetingOn ?? '',
  salesUserId: row?.salesUserId ?? '',
  remarks: row?.remarks ?? '',
});

const orNull = (value: string) => value.trim() || null;

/** The company name a moment after the member stops typing */
function useSettled(value: string, delay = 400) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * Record a conversation in about thirty seconds (#265): the three required fields and the chips
 * first, the details folded away. Sales also see the columns they fill in.
 */
export function ProspectFormDialog({
  organizationId,
  row,
  open,
  onOpenChange,
  isSales,
  members,
  today,
}: {
  organizationId: string;
  /** null: a new row */
  row: ProspectRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSales: boolean;
  members: { id: string; name: string }[];
  today: string;
}) {
  const t = useTranslations('prospects');
  const tPipeline = useTranslations('pipeline');
  const utils = trpc.useUtils();
  const [form, setForm] = useState<FormState>(() => toForm(row, today));
  const [errors, setErrors] = useState<Partial<Record<RequiredKey, boolean>>>({});
  const [showDetails, setShowDetails] = useState(
    () => !!(row?.department || row?.jobTitle || row?.surname || row?.explainedOn)
  );
  const fieldRefs = useRef<Partial<Record<RequiredKey, HTMLElement | null>>>({});
  const set = (key: TextKey) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value === NONE ? '' : value }));
    if (key in errors) setErrors((current) => ({ ...current, [key]: false }));
  };
  const locked = !!row?.leadId;

  const company = useSettled(form.company.trim());
  const similar = trpc.prospects.similar.useQuery(
    { organizationId, company, excludeId: row?.id },
    { enabled: company.length >= 2, retry: false, staleTime: 30_000 }
  );

  const done = () => {
    toast.success(t('saved'));
    utils.prospects.list.invalidate();
    utils.prospects.summary.invalidate();
    onOpenChange(false);
  };
  const failed = () => toast.error(t('saveError'));
  const create = trpc.prospects.create.useMutation({ onSuccess: done, onError: failed });
  const update = trpc.prospects.update.useMutation({ onSuccess: done, onError: failed });
  const pending = create.isPending || update.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const missing: Partial<Record<RequiredKey, boolean>> = {
      contactedOn: !form.contactedOn,
      entry: !form.entry,
      company: !form.company.trim(),
    };
    setErrors(missing);
    const first = (['contactedOn', 'entry', 'company'] as const).find((key) => missing[key]);
    if (first) {
      fieldRefs.current[first]?.focus();
      return;
    }
    const values = {
      organizationId,
      contactedOn: form.contactedOn,
      entry: form.entry as (typeof PROSPECT_ENTRIES)[number],
      company: form.company,
      department: orNull(form.department),
      jobTitle: orNull(form.jobTitle),
      surname: orNull(form.surname),
      explainedOn: orNull(form.explainedOn),
      heard: orNull(form.heard),
      systemScope: orNull(form.systemScope) as (typeof PROSPECT_SYSTEM_SCOPES)[number] | null,
      targetSystem: orNull(form.targetSystem) as (typeof TARGET_SYSTEMS)[number] | null,
      supportEndSoon: orNull(form.supportEndSoon) as (typeof PROSPECT_SUPPORT_END)[number] | null,
      troubles: form.troubles as (typeof PROSPECT_TROUBLES)[number][],
      reaction: orNull(form.reaction) as (typeof PROSPECT_REACTIONS)[number] | null,
      nextStep: orNull(form.nextStep) as (typeof PROSPECT_NEXT_STEPS)[number] | null,
      nextActionOn: orNull(form.nextActionOn),
      nextActionNote: orNull(form.nextActionNote),
      stage: orNull(form.stage) as (typeof PROSPECT_STAGES)[number] | null,
      meetingOn: orNull(form.meetingOn),
      salesUserId: orNull(form.salesUserId),
      remarks: orNull(form.remarks),
    };
    if (row) update.mutate({ ...values, id: row.id });
    else create.mutate(values);
  };

  const errorText = (key: RequiredKey) =>
    errors[key] ? (
      <p id={`prospect-${key}-error`} className="text-xs text-destructive">
        {t(`form.errors.${key}`)}
      </p>
    ) : null;

  /** One tap to pick; tapping the picked chip again clears it */
  const chips = (
    key: TextKey,
    options: readonly string[],
    label: (option: string) => string,
    title: string
  ) => (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{title}</legend>
      <ToggleGroup
        type="single"
        size="sm"
        value={form[key]}
        onValueChange={(value) => set(key)(value)}
        className="flex flex-wrap justify-start gap-1.5"
      >
        {options.map((option) => (
          <ToggleGroupItem key={option} value={option} className={CHIP}>
            {label(option)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </fieldset>
  );

  const field = (
    key: TextKey,
    type: 'text' | 'date' = 'text',
    options: { hint?: string; maxLength?: number } = {}
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`prospect-${key}`}>{t(`columns.${key}` as 'columns.company')}</Label>
      <Input
        id={`prospect-${key}`}
        type={type}
        value={form[key]}
        maxLength={options.maxLength}
        onChange={(event) => set(key)(event.target.value)}
      />
      {options.hint && <p className="text-xs text-muted-foreground">{options.hint}</p>}
    </div>
  );

  const similarRows = similar.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[95vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{row ? t('dialog.editTitle') : t('dialog.addTitle')}</DialogTitle>
          <DialogDescription>{t('form.quickHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
            <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="prospect-contactedOn">
                  {t('columns.contactedOn')}
                  <span className="text-destructive"> *</span>
                </Label>
                <Input
                  id="prospect-contactedOn"
                  ref={(element) => {
                    fieldRefs.current.contactedOn = element;
                  }}
                  type="date"
                  value={form.contactedOn}
                  onChange={(event) => set('contactedOn')(event.target.value)}
                  aria-required="true"
                  aria-invalid={errors.contactedOn || undefined}
                  aria-describedby={errors.contactedOn ? 'prospect-contactedOn-error' : undefined}
                />
                {errorText('contactedOn')}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prospect-company">
                  {t('columns.company')}
                  <span className="text-destructive"> *</span>
                </Label>
                <Input
                  id="prospect-company"
                  ref={(element) => {
                    fieldRefs.current.company = element;
                  }}
                  value={form.company}
                  maxLength={200}
                  autoComplete="off"
                  onChange={(event) => set('company')(event.target.value)}
                  aria-required="true"
                  aria-invalid={errors.company || undefined}
                  aria-describedby={
                    [
                      errors.company ? 'prospect-company-error' : null,
                      similarRows.length > 0 ? 'prospect-similar' : null,
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                />
                {errorText('company')}
                {similarRows.length > 0 && (
                  <div
                    id="prospect-similar"
                    aria-live="polite"
                    className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                  >
                    <p className="flex items-start gap-1.5 font-medium">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {t('form.similar', { count: similarRows.length })}
                    </p>
                    <ul className="mt-1 space-y-0.5 pl-5">
                      {similarRows.map((item) => (
                        <li key={item.id}>
                          {item.company}（
                          {t('form.similarItem', {
                            date: item.contactedOn,
                            recorder: item.recorder ?? '',
                          })}
                          ）
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <fieldset
              className="space-y-1.5"
              aria-describedby={errors.entry ? 'prospect-entry-error' : undefined}
            >
              <legend className="text-sm font-medium">
                {t('columns.entry')}
                <span className="text-destructive"> *</span>
              </legend>
              <ToggleGroup
                type="single"
                size="sm"
                value={form.entry}
                onValueChange={(value) => set('entry')(value)}
                className="flex flex-wrap justify-start gap-1.5"
              >
                {PROSPECT_ENTRIES.map((option, index) => (
                  <ToggleGroupItem
                    key={option}
                    value={option}
                    className={CHIP}
                    aria-invalid={errors.entry || undefined}
                    ref={
                      index === 0
                        ? (element) => {
                            fieldRefs.current.entry = element;
                          }
                        : undefined
                    }
                  >
                    {t(`entry.${option}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {errorText('entry')}
            </fieldset>

            {chips(
              'targetSystem',
              TARGET_SYSTEMS,
              (option) => tPipeline(`targetSystem.${option}` as 'targetSystem.as400'),
              t('columns.targetSystem')
            )}
            {chips(
              'supportEndSoon',
              PROSPECT_SUPPORT_END,
              (option) => t(`supportEnd.${option}` as 'supportEnd.yes'),
              t('columns.supportEndSoon')
            )}

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">{t('columns.troubles')}</legend>
              <ToggleGroup
                type="multiple"
                size="sm"
                value={form.troubles}
                onValueChange={(value) => setForm((current) => ({ ...current, troubles: value }))}
                className="flex flex-wrap justify-start gap-1.5"
              >
                {PROSPECT_TROUBLES.map((option) => (
                  <ToggleGroupItem key={option} value={option} className={CHIP}>
                    {t(`troubles.${option}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="prospect-heard">{t('columns.heard')}</Label>
              <Textarea
                id="prospect-heard"
                rows={3}
                maxLength={2000}
                value={form.heard}
                onChange={(event) => set('heard')(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('hints.heard')}</p>
            </div>

            {chips(
              'reaction',
              PROSPECT_REACTIONS,
              (option) => t(`reaction.${option}` as 'reaction.unknown'),
              t('columns.reaction')
            )}
            <div className="space-y-1.5">
              {chips(
                'nextStep',
                PROSPECT_NEXT_STEPS,
                (option) => t(`nextStep.${option}` as 'nextStep.pass'),
                t('columns.nextStep')
              )}
              {form.nextStep === 'hand_over' && !row?.handedOverAt && (
                <p className="text-xs text-muted-foreground">{t('form.handOverHint')}</p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('nextActionOn', 'date')}
              {field('nextActionNote', 'text', {
                maxLength: 100,
                hint: t('hints.nextActionNote'),
              })}
            </div>

            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="px-0"
                aria-expanded={showDetails}
                aria-controls="prospect-details"
                onClick={() => setShowDetails((value) => !value)}
              >
                {showDetails ? (
                  <ChevronUp className="mr-1 h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="mr-1 h-4 w-4" aria-hidden="true" />
                )}
                {showDetails ? t('form.less') : t('form.more')}
              </Button>
              {showDetails && (
                <div id="prospect-details" className="mt-3 grid gap-4 sm:grid-cols-2">
                  {field('department', 'text', { maxLength: 100 })}
                  {field('jobTitle', 'text', { maxLength: 100 })}
                  {field('surname', 'text', { maxLength: 50, hint: t('hints.surname') })}
                  {field('explainedOn', 'date', { hint: t('hints.explainedOn') })}
                  {chips(
                    'systemScope',
                    PROSPECT_SYSTEM_SCOPES,
                    (option) => t(`systemScope.${option}` as 'systemScope.core'),
                    t('columns.systemScope')
                  )}
                </div>
              )}
            </div>

            {isSales && (
              <fieldset className="space-y-4 rounded-md border border-sky-200 bg-sky-50/50 p-4 dark:border-sky-900 dark:bg-sky-950/30">
                <legend className="px-1 text-sm font-medium">{t('hints.salesSection')}</legend>
                {locked && <p className="text-xs text-muted-foreground">{t('leadLocked')}</p>}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="prospect-stage">{t('columns.stage')}</Label>
                    <Select
                      value={form.stage || NONE}
                      onValueChange={set('stage')}
                      disabled={locked}
                    >
                      <SelectTrigger id="prospect-stage">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{t('none')}</SelectItem>
                        {PROSPECT_STAGES.map((option) => (
                          <SelectItem key={option} value={option}>
                            {t(`stage.${option}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {field('meetingOn', 'date')}
                  <div className="space-y-1.5">
                    <Label htmlFor="prospect-salesUserId">{t('columns.salesUser')}</Label>
                    <Select value={form.salesUserId || NONE} onValueChange={set('salesUserId')}>
                      <SelectTrigger id="prospect-salesUserId">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{t('none')}</SelectItem>
                        {members.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prospect-remarks">{t('columns.remarks')}</Label>
                  <Textarea
                    id="prospect-remarks"
                    rows={2}
                    maxLength={2000}
                    value={form.remarks}
                    onChange={(event) => set('remarks')(event.target.value)}
                  />
                </div>
              </fieldset>
            )}
          </div>

          {/* Always visible, so a long form on a phone never hides the save button */}
          <div className="flex justify-end gap-2 border-t bg-background px-6 py-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={pending} className="min-w-24">
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {t('actions.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
