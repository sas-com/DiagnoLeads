/**
 * Lead hearing schemas, generated from the catalog (Refs #84)
 *
 * Input is strict: unknown keys and invalid values are rejected. Stored rows are read
 * tolerantly: a key or value that the current catalog no longer accepts is dropped and
 * reported, so a catalog change never makes an old hearing unreadable.
 */

import { z } from 'zod';
import {
  HEARING_FIELDS,
  HEARING_ITEM_STATUSES,
  HEARING_OTHER_NOTE_MAX_LENGTH,
  HEARING_VALUE_SOURCES,
  type HearingFieldDefinition,
  type HearingFieldKey,
  type HearingItemStatus,
  type HearingValueSource,
  choosesOtherOption,
  getHearingField,
  hasOtherOption,
} from '../catalog';

/** Value of one field; the shape depends on the field type (see catalog.ts) */
export type HearingFieldValue =
  | string
  | string[]
  | number
  | { basis: string; bucket: string }
  | Partial<Record<string, string>>;

export interface HearingFieldEntry {
  value?: HearingFieldValue;
  status: HearingItemStatus;
  source: HearingValueSource | null;
  /**
   * What "other" means, written when an "other" option (see isOtherOption in catalog.ts) is
   * chosen. Only choice fields that have such an option accept it; one note per field. Saved
   * only while an "other" option is chosen (toSavedHearingFields drops it otherwise). Hearings
   * stored before #130 have no note and read as before.
   */
  otherNote?: string;
}

export type HearingFields = Partial<Record<HearingFieldKey, HearingFieldEntry>>;

/** 'YYYY-MM' */
export const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
/** 'YYYY-MM-DD' (shape only; isoDateSchema also checks the calendar) */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' that is a real calendar date */
export const isoDateSchema = z
  .string()
  .regex(ISO_DATE_PATTERN)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Invalid date');

const enumOf = (values: readonly string[]) => z.enum(values as [string, ...string[]]);

const valuesOf = (options: readonly { value: string }[]) => options.map((o) => o.value);

function valueSchemaFor(field: HearingFieldDefinition): z.ZodType<HearingFieldValue> {
  switch (field.type) {
    case 'single':
      return enumOf(valuesOf(field.options));
    case 'multiple': {
      const values = valuesOf(field.options);
      return z
        .array(enumOf(values))
        .min(1)
        .max(values.length)
        .refine((list) => new Set(list).size === list.length, 'Duplicate options');
    }
    case 'text':
      return z.string().trim().min(1).max(field.maxLength);
    case 'number':
      return z.number().int().min(field.min).max(field.max);
    case 'yearMonth':
      return z.string().regex(YEAR_MONTH_PATTERN);
    case 'date':
      return isoDateSchema;
    case 'levels': {
      const level = enumOf(valuesOf(field.levels));
      return z
        .object(Object.fromEntries(field.items.map((item) => [item.value, level.optional()])))
        .strict() as z.ZodType<Partial<Record<string, string>>>;
    }
    case 'scale': {
      const buckets = new Map(field.bases.map((b) => [b.questionId, valuesOf(b.buckets)]));
      return z
        .object({ basis: enumOf([...buckets.keys()]), bucket: z.string() })
        .strict()
        .refine((v) => buckets.get(v.basis)?.includes(v.bucket) ?? false, 'Unknown bucket');
    }
  }
}

const statusSchema = z.enum(HEARING_ITEM_STATUSES);
const sourceSchema = z.enum(HEARING_VALUE_SOURCES).nullable();

const otherNoteSchema = z.string().trim().min(1).max(HEARING_OTHER_NOTE_MAX_LENGTH);

function entryObjectFor(field: HearingFieldDefinition) {
  return z
    .object({
      value: valueSchemaFor(field).optional(),
      status: statusSchema,
      source: sourceSchema,
      // Only fields with an "other" option know the key; strict() rejects it elsewhere
      ...(hasOtherOption(field) ? { otherNote: otherNoteSchema.optional() } : {}),
    })
    .strict();
}

/** Entry as stored (read path): a note left without its "other" option is tolerated */
const entrySchemas = new Map<string, z.ZodType<HearingFieldEntry>>(
  HEARING_FIELDS.map((field) => [field.key, entryObjectFor(field) as z.ZodType<HearingFieldEntry>])
);

/** Entry to save: a note is only accepted next to a chosen "other" option */
const saveEntrySchemas = new Map<string, z.ZodType<HearingFieldEntry>>(
  HEARING_FIELDS.map((field) => [
    field.key,
    entryObjectFor(field).refine(
      (entry) =>
        (entry as HearingFieldEntry).otherNote === undefined || choosesOtherOption(entry.value),
      { message: 'A note needs an "other" option', path: ['otherNote'] }
    ) as unknown as z.ZodType<HearingFieldEntry>,
  ])
);

/** Strict schema for saving: every key must be in the catalog and every value valid */
export const hearingFieldsSchema = z
  .object(
    Object.fromEntries(
      HEARING_FIELDS.map((field) => [
        field.key,
        (saveEntrySchemas.get(field.key) as z.ZodType<HearingFieldEntry>).optional(),
      ])
    )
  )
  .strict() as unknown as z.ZodType<HearingFields>;

/**
 * Read stored fields. Keys that are not in the catalog (retired) or whose entry no longer
 * validates are dropped and listed in droppedKeys.
 */
export function parseStoredHearingFields(raw: unknown): {
  fields: HearingFields;
  droppedKeys: string[];
} {
  const fields: Record<string, HearingFieldEntry> = {};
  const droppedKeys: string[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { fields, droppedKeys };
  }
  for (const [key, entry] of Object.entries(raw)) {
    const schema = getHearingField(key) ? entrySchemas.get(key) : undefined;
    const parsed = schema?.safeParse(entry);
    if (parsed?.success) {
      fields[key] = parsed.data;
    } else {
      droppedKeys.push(key);
    }
  }
  return { fields: fields as HearingFields, droppedKeys };
}

// ── Prefill snapshot ────────────────────────────────────────────────────────────

/**
 * What the Web diagnosis said when the hearing was created, kept on the hearing so the screen
 * can show "Web diagnosis: ..." next to each field even if the submission changes later.
 */
export interface HearingPrefillSnapshot {
  submissionId: string;
  diagnosticKey: string;
  diagnosticVersion: number;
  submittedAt: string;
  /**
   * false when the submission matched an existing lead by email instead of creating it
   * (anyone can submit with someone else's address), so the answers are not verified
   */
  verified: boolean;
  /** Answers of the diagnosis questions the hearing uses */
  answers: Record<string, string | string[]>;
  challenges: { primary: string | null; selected: string[] } | null;
  /** Diagnosis questions behind each field (also for fields that got no value) */
  hints: Partial<Record<HearingFieldKey, string[]>>;
}

// ── API inputs ──────────────────────────────────────────────────────────────────

const organizationId = z.string().uuid();

export const listLeadHearingsSchema = z
  .object({ organizationId, leadId: z.string().uuid() })
  .strict();

export const getLeadHearingSchema = z.object({ organizationId, id: z.string().uuid() }).strict();

export const leadHearingPrefillSourcesSchema = listLeadHearingsSchema;

export const createLeadHearingSchema = z
  .object({
    organizationId,
    leadId: z.string().uuid(),
    heldOn: isoDateSchema,
    /** Diagnosis submission to prefill from; the newest one of the lead when omitted */
    submissionId: z.string().uuid().optional(),
    /**
     * Copy the latest hearing's values (default when the lead already has a hearing).
     * false starts again from the diagnosis.
     */
    carryOver: z.boolean().optional(),
  })
  .strict();

export const updateLeadHearingSchema = z
  .object({
    organizationId,
    id: z.string().uuid(),
    heldOn: isoDateSchema,
    /** Replaces all fields */
    fields: hearingFieldsSchema,
    /** updatedAt the client last read; a newer row means someone else saved meanwhile */
    expectedUpdatedAt: z.date(),
  })
  .strict();

export const deleteLeadHearingSchema = getLeadHearingSchema;

/** The meeting summary of a hearing, labelled in this language */
export const leadHearingSummarySchema = z
  .object({ organizationId, id: z.string().uuid(), locale: z.enum(['ja', 'en']).optional() })
  .strict();

export type CreateLeadHearingInput = z.infer<typeof createLeadHearingSchema>;
export type UpdateLeadHearingInput = z.infer<typeof updateLeadHearingSchema>;
