'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdateLead } from '@/hooks/use-leads';
import type { Lead as LeadRow } from '@/lib/db/schema';
import {
  type LeadCardField,
  type LeadCardId,
  cardFields,
  splitCardFields,
} from '@/lib/features/leads/detail-fields';
import {
  CONVERSION_POINTS,
  DEAL_PHASES,
  INFLOW_SOURCES,
  LOST_REASONS,
  SQL_DECISIONS,
  TARGET_SYSTEMS,
  updateLeadSchema,
} from '@/lib/features/leads/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown, ChevronRight, Loader2, Pencil } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type FieldPath, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useEditSession } from './edit-session';

/** Sentinel for "not set": Radix Select does not accept an empty value */
const NONE = '__none__';
const TIME_ZONE = 'Asia/Tokyo';

/** Everything the cards edit, validated with the lead update schema */
const cardSchema = updateLeadSchema.pick({
  name: true,
  company: true,
  email: true,
  phone: true,
  inflowSource: true,
  agencyName: true,
  acquisitionCost: true,
  referrerName: true,
  conversionPoint: true,
  dealPhase: true,
  targetSystem: true,
  mqlQualified: true,
  sqlDecision: true,
  lostReason: true,
});
type CardValues = z.infer<typeof cardSchema>;
/** Form field names are the card fields */
type CardFieldName = FieldPath<CardValues> & LeadCardField;

/** leads.get also says whether the lead has deals (#444) */
type Lead = LeadRow & { hasDeals?: boolean };

const SELECT_OPTIONS: Partial<Record<LeadCardField, readonly string[]>> = {
  inflowSource: INFLOW_SOURCES,
  conversionPoint: CONVERSION_POINTS,
  dealPhase: DEAL_PHASES,
  targetSystem: TARGET_SYSTEMS,
  lostReason: LOST_REASONS,
  sqlDecision: SQL_DECISIONS,
};
const TEXT_TYPES: Partial<Record<LeadCardField, 'text' | 'email' | 'tel'>> = {
  name: 'text',
  company: 'text',
  email: 'email',
  phone: 'tel',
  agencyName: 'text',
  referrerName: 'text',
};
/** Text fields stored as null when emptied (the others are plain strings) */
const NULLABLE_TEXT = new Set<LeadCardField>(['agencyName', 'referrerName']);
const NUMBER_FIELDS = new Set<LeadCardField>(['acquisitionCost']);

function formValues(lead: Lead): CardValues {
  return {
    name: lead.name ?? '',
    company: lead.company ?? '',
    email: lead.email,
    phone: lead.phone ?? '',
    inflowSource: (lead.inflowSource as CardValues['inflowSource']) ?? null,
    agencyName: lead.agencyName ?? null,
    acquisitionCost: lead.acquisitionCost ?? null,
    referrerName: lead.referrerName ?? null,
    conversionPoint: (lead.conversionPoint as CardValues['conversionPoint']) ?? null,
    dealPhase: (lead.dealPhase as CardValues['dealPhase']) ?? null,
    targetSystem: (lead.targetSystem as CardValues['targetSystem']) ?? null,
    mqlQualified: Boolean(lead.mqlQualifiedAt),
    sqlDecision: (lead.sqlDecision as CardValues['sqlDecision']) ?? null,
    lostReason: (lead.lostReason as CardValues['lostReason']) ?? null,
  };
}

/**
 * The values of the card's own fields. Only these are checked when saving: a stored value of
 * another card over a limit set later (#575) would refuse the save without showing why.
 */
function cardValues(lead: Lead, fields: readonly CardFieldName[]): CardValues {
  const values = formValues(lead);
  return Object.fromEntries(fields.map((field) => [field, values[field]])) as CardValues;
}

/** Field labels of the lead form */
function useFieldLabel() {
  const t = useTranslations('leads');
  const tDetail = useTranslations('leadDetail');
  return (field: LeadCardField, editing = false) => {
    if (field === 'mqlQualified') return editing ? t('mqlQualified') : tDetail('fields.mql');
    return t(field);
  };
}

interface LeadFieldsCardProps {
  card: LeadCardId;
  icon: ComponentType<{ className?: string }>;
  lead: Lead;
  organizationId: string;
  canEdit: boolean;
  /** Read-only lines under the fields (e.g. the dates each deal phase was reached) */
  footer?: ReactNode;
}

/**
 * A card of lead fields edited in place (Refs #107, #109).
 * View: only the fields with a value, and one line "未設定 n 件・入力する" for the rest.
 * Edit (its own 編集 button): inputs for all of the card's fields, キャンセル／保存 at the bottom,
 * Esc cancels, Enter in a one-line input saves. Only the changed fields are sent.
 */
export function LeadFieldsCard({
  card,
  icon: Icon,
  lead,
  organizationId,
  canEdit,
  footer,
}: LeadFieldsCardProps) {
  const t = useTranslations('leadDetail');
  const session = useEditSession();
  const editing = session.editing === card && canEdit;
  const editButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const headingId = useId();
  const title = t(`cards.${card}`);

  // Back to the 編集 button after saving or cancelling
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  const finish = () => {
    returnFocus.current = true;
    session.close();
  };

  return (
    <section aria-labelledby={headingId}>
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2
            id={headingId}
            className="flex items-center gap-2 text-base font-semibold text-foreground"
          >
            <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            {title}
          </h2>
          {canEdit && !editing && (
            <Button
              ref={editButton}
              variant="ghost"
              size="sm"
              aria-label={t('edit.editCard', { card: title })}
              onClick={() => session.open(card)}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              {t('edit.edit')}
            </Button>
          )}
        </div>

        {editing ? (
          <CardForm
            card={card}
            lead={lead}
            organizationId={organizationId}
            focusField={session.focusField}
            onDone={finish}
          />
        ) : (
          <CardView card={card} lead={lead} canEdit={canEdit} footer={footer} />
        )}
      </Card>
    </section>
  );
}

function CardView({
  card,
  lead,
  canEdit,
  footer,
}: {
  card: LeadCardId;
  lead: Lead;
  canEdit: boolean;
  footer?: ReactNode;
}) {
  const t = useTranslations('leadDetail');
  const label = useFieldLabel();
  const session = useEditSession();
  const [showEmpty, setShowEmpty] = useState(false);
  const { filled, empty } = splitCardFields(card, lead);
  const listId = useId();

  return (
    <>
      {filled.length > 0 && (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {filled.map((field) => (
            <div key={field} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label(field)}</dt>
              <dd className="mt-0.5 break-words text-sm font-medium text-foreground">
                <FieldValue field={field} lead={lead} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {footer}
      {empty.length > 0 && (
        <div
          className={filled.length > 0 || footer ? 'mt-3 border-t pt-2 dark:border-gray-700' : ''}
        >
          <div className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
            <button
              type="button"
              aria-expanded={showEmpty}
              aria-controls={listId}
              onClick={() => setShowEmpty((value) => !value)}
              className="inline-flex min-h-9 items-center gap-1 rounded-md hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showEmpty ? (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              )}
              {t('empty.count', { count: empty.length })}
            </button>
            {canEdit && (
              <>
                <span aria-hidden="true">・</span>
                <button
                  type="button"
                  onClick={() => session.open(card, empty[0])}
                  className="inline-flex min-h-9 items-center rounded-md text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-blue-400"
                >
                  {t('empty.fill')}
                </button>
              </>
            )}
          </div>
          {showEmpty && (
            <ul
              id={listId}
              aria-label={t('empty.list')}
              className="mt-1 flex flex-wrap gap-x-3 gap-y-1 pl-5 text-sm text-muted-foreground"
            >
              {empty.map((field) => (
                <li key={field}>{label(field)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

/** A field's value as text (only called for fields with a value) */
function FieldValue({ field, lead }: { field: LeadCardField; lead: Lead }) {
  const tPipeline = useTranslations('pipeline');
  const tDetail = useTranslations('leadDetail');
  const format = useFormatter();
  const date = (value: Date | string) =>
    format.dateTime(new Date(value), { dateStyle: 'medium', timeZone: TIME_ZONE });

  switch (field) {
    case 'email':
      return (
        <a
          href={`mailto:${lead.email}`}
          className="text-blue-600 hover:underline dark:text-blue-400"
        >
          {lead.email}
        </a>
      );
    case 'phone':
      return (
        <a href={`tel:${lead.phone}`} className="text-blue-600 hover:underline dark:text-blue-400">
          {lead.phone}
        </a>
      );
    case 'acquisitionCost':
      return (
        <>{format.number(lead.acquisitionCost ?? 0, { style: 'currency', currency: 'JPY' })}</>
      );
    case 'mqlQualified':
      return (
        <>
          {lead.mqlQualifiedAt ? tDetail('fields.mqlYes', { date: date(lead.mqlQualifiedAt) }) : ''}
        </>
      );
    case 'sqlDecision':
      return (
        <>
          {tPipeline(`sqlDecision.${lead.sqlDecision}`)}
          {lead.sqlDecidedAt && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {date(lead.sqlDecidedAt)}
            </span>
          )}
        </>
      );
    default: {
      const value = lead[field];
      if (SELECT_OPTIONS[field]) {
        const key = `${field}.${value}`;
        return <>{tPipeline.has(key) ? tPipeline(key) : String(value)}</>;
      }
      return <>{String(value ?? '')}</>;
    }
  }
}

function CardForm({
  card,
  lead,
  organizationId,
  focusField,
  onDone,
}: {
  card: LeadCardId;
  lead: Lead;
  organizationId: string;
  focusField: LeadCardField | null;
  onDone: () => void;
}) {
  const t = useTranslations('leadDetail');
  const tLeads = useTranslations('leads');
  const tPipeline = useTranslations('pipeline');
  const tValidation = useTranslations('validation');
  const label = useFieldLabel();
  const session = useEditSession();
  const updateLead = useUpdateLead();
  const fields = cardFields(card, lead) as CardFieldName[];

  // Messages of the update schema in the page's language
  const errorMap = useMemo<z.ZodErrorMap>(
    () => (issue, ctx) => {
      if (issue.code === z.ZodIssueCode.too_big) {
        return {
          message:
            issue.type === 'string'
              ? tValidation('maxLength', { max: Number(issue.maximum) })
              : tValidation('max', { max: Number(issue.maximum) }),
        };
      }
      if (issue.code === z.ZodIssueCode.too_small) {
        return { message: tValidation('min', { min: Number(issue.minimum) }) };
      }
      if (issue.code === z.ZodIssueCode.invalid_string && issue.validation === 'email') {
        return { message: tValidation('email') };
      }
      if (issue.code === z.ZodIssueCode.invalid_type) {
        if (issue.expected === 'integer') return { message: t('edit.integer') };
        if (issue.expected === 'number') return { message: t('edit.invalidNumber') };
      }
      return { message: ctx.defaultError };
    },
    [t, tValidation]
  );

  const form = useForm<CardValues>({
    resolver: zodResolver(cardSchema, { errorMap }),
    defaultValues: cardValues(lead, fields),
  });
  const { isDirty } = form.formState;

  useEffect(() => {
    session.setDirty(isDirty);
  }, [isDirty, session.setDirty]);

  // Focus the requested field (the first empty one from "入力する") or the first field, once
  // when the card opens
  const focusTarget =
    focusField && fields.includes(focusField as CardFieldName) ? focusField : fields[0];
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || !focusTarget) return;
    focused.current = true;
    form.setFocus(focusTarget as CardFieldName);
  }, [focusTarget, form]);

  const submit = form.handleSubmit(async (values) => {
    const dirty = form.formState.dirtyFields as Partial<Record<keyof CardValues, unknown>>;
    const changes = Object.fromEntries(
      Object.entries(values).filter(
        ([key, value]) => Boolean(dirty[key as keyof CardValues]) && value !== undefined
      )
    ) as Partial<CardValues>;
    if (Object.keys(changes).length === 0) {
      onDone();
      return;
    }
    try {
      await updateLead.mutateAsync({ ...changes, id: lead.id, organizationId });
    } catch {
      // useUpdateLead showed the error; the inputs stay as typed
      return;
    }
    onDone();
  });

  const cancel = () => {
    form.reset(cardValues(lead, fields));
    onDone();
  };

  // Esc cancels, unless it is closing an open select list
  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest('[role="listbox"]') || target.getAttribute('aria-expanded') === 'true')
      return;
    event.preventDefault();
    cancel();
  };

  return (
    <Form {...form}>
      <form onSubmit={submit} onKeyDown={handleKeyDown} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((name) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => {
                // A lost lead cannot be put on hold (#445): on hold is nurturing
                const options =
                  name === 'lostReason' && lead.status === 'lost' && lead.lostReason !== 'on_hold'
                    ? SELECT_OPTIONS[name]?.filter((option) => option !== 'on_hold')
                    : SELECT_OPTIONS[name];
                if (name === 'mqlQualified') {
                  return (
                    <FormItem className="flex items-center gap-2 space-y-0 sm:col-span-2">
                      <FormControl>
                        <Checkbox
                          ref={field.ref}
                          checked={field.value === true}
                          onCheckedChange={(state) => field.onChange(state === true)}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">{label(name, true)}</FormLabel>
                    </FormItem>
                  );
                }
                if (options) {
                  const noneLabel =
                    name === 'sqlDecision' ? tLeads('sqlUndecided') : tLeads('notSet');
                  // The deals set the deal phase of a lead with deals (#444)
                  const fromDeals = name === 'dealPhase' && lead.hasDeals === true;
                  return (
                    <FormItem>
                      <FormLabel>{label(name, true)}</FormLabel>
                      <Select
                        value={typeof field.value === 'string' ? field.value : NONE}
                        onValueChange={(value) => field.onChange(value === NONE ? null : value)}
                        disabled={fromDeals}
                      >
                        <FormControl>
                          <SelectTrigger ref={field.ref} onBlur={field.onBlur}>
                            <SelectValue placeholder={noneLabel} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={NONE}>{noneLabel}</SelectItem>
                          {options.map((option) => (
                            <SelectItem key={option} value={option}>
                              {tPipeline(`${name}.${option}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {fromDeals && <FormDescription>{t('fromDeals')}</FormDescription>}
                      <FormMessage />
                    </FormItem>
                  );
                }
                if (NUMBER_FIELDS.has(name)) {
                  return (
                    <FormItem>
                      <FormLabel>{label(name, true)}</FormLabel>
                      <FormControl>
                        <Input
                          ref={field.ref}
                          name={field.name}
                          onBlur={field.onBlur}
                          type="number"
                          inputMode="numeric"
                          step={1}
                          value={typeof field.value === 'number' ? field.value : ''}
                          onChange={(event) => {
                            const raw = event.target.value;
                            field.onChange(raw === '' ? null : Number(raw));
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }
                return (
                  <FormItem>
                    <FormLabel>
                      {label(name, true)}
                      {name === 'email' && ' *'}
                    </FormLabel>
                    <FormControl>
                      <Input
                        ref={field.ref}
                        name={field.name}
                        onBlur={field.onBlur}
                        type={TEXT_TYPES[name] ?? 'text'}
                        value={typeof field.value === 'string' ? field.value : ''}
                        onChange={(event) => {
                          const raw = event.target.value;
                          field.onChange(NULLABLE_TEXT.has(name) && raw === '' ? null : raw);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t pt-3 dark:border-gray-700">
          <Button type="button" variant="outline" onClick={cancel} disabled={updateLead.isPending}>
            {t('edit.cancel')}
          </Button>
          <Button type="submit" disabled={updateLead.isPending}>
            {updateLead.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {updateLead.isPending ? t('edit.saving') : t('edit.save')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
