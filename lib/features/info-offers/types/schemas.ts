import { z } from 'zod';

/**
 * Offers for respondents still gathering information (Refs #153): documents to download (e.g. a
 * checklist per system) and seminars / webinars to sign up for, shown on the AX diagnosis result
 * next to the consultation. Kept in organizations.settings.axInfoOffers; hidden until `enabled`
 * is turned on (the switch stands in for a feature flag while the contents are prepared).
 */

export const OFFER_KINDS = ['document', 'seminar'] as const;
export const offerKindEnum = z.enum(OFFER_KINDS);
export type OfferKind = z.infer<typeof offerKindEnum>;

export const INFO_OFFER_LIMITS = {
  items: 5,
  title: 100,
  description: 300,
  url: 500,
  time: 30,
  format: 100,
  id: 64,
} as const;

const text = (max: number) => z.string().trim().max(max);
const offerId = z
  .string()
  .trim()
  .min(1)
  .max(INFO_OFFER_LIMITS.id)
  .regex(/^[A-Za-z0-9_-]+$/);
const httpsUrl = z
  .string()
  .trim()
  .max(INFO_OFFER_LIMITS.url)
  .url()
  .refine((value) => value.startsWith('https://'), { message: 'https only' });

export const infoDocumentSchema = z.object({
  id: offerId,
  title: text(INFO_OFFER_LIMITS.title).min(1),
  description: text(INFO_OFFER_LIMITS.description).default(''),
  /** Where the file is; handed out only after the request is recorded */
  url: httpsUrl,
});
export type InfoDocument = z.infer<typeof infoDocumentSchema>;

export const infoSeminarSchema = z.object({
  id: offerId,
  title: text(INFO_OFFER_LIMITS.title).min(1),
  description: text(INFO_OFFER_LIMITS.description).default(''),
  /** YYYY-MM-DD; seminars past this day are no longer offered */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** e.g. "15:00-16:00" */
  time: text(INFO_OFFER_LIMITS.time).default(''),
  /** e.g. "Online" or the venue */
  format: text(INFO_OFFER_LIMITS.format).default(''),
});
export type InfoSeminar = z.infer<typeof infoSeminarSchema>;

const uniqueIds = (items: { id: string }[]) =>
  new Set(items.map((item) => item.id)).size === items.length;

export const infoOffersSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  documents: z
    .array(infoDocumentSchema)
    .max(INFO_OFFER_LIMITS.items)
    .default([])
    .refine(uniqueIds, { message: 'Duplicate id' }),
  seminars: z
    .array(infoSeminarSchema)
    .max(INFO_OFFER_LIMITS.items)
    .default([])
    .refine(uniqueIds, { message: 'Duplicate id' }),
});
export type InfoOffersSettings = z.infer<typeof infoOffersSettingsSchema>;

export const INFO_OFFERS_SETTINGS_KEY = 'axInfoOffers';
export const DEFAULT_INFO_OFFERS: InfoOffersSettings = infoOffersSettingsSchema.parse({});

/** Read the settings stored in organizations.settings (broken values read as none) */
export function readInfoOffers(settings: unknown): InfoOffersSettings {
  const value =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)[INFO_OFFERS_SETTINGS_KEY]
      : undefined;
  const parsed = infoOffersSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : DEFAULT_INFO_OFFERS;
}

/** What the public result page sees: no file locations, only seminars from today on */
export interface PublicInfoOffers {
  documents: { id: string; title: string; description: string }[];
  seminars: InfoSeminar[];
}

/** The offers to show on the result page; null when switched off or empty */
export function publicInfoOffers(
  settings: InfoOffersSettings,
  today: string
): PublicInfoOffers | null {
  if (!settings.enabled) return null;
  const documents = settings.documents.map(({ id, title, description }) => ({
    id,
    title,
    description,
  }));
  const seminars = settings.seminars.filter((seminar) => seminar.date >= today);
  if (documents.length === 0 && seminars.length === 0) return null;
  return { documents, seminars };
}

/** Lead score added for each request, and for attending a seminar (capped at 100) */
export const OFFER_SCORE = { document: 5, seminar: 10, attended: 10 } as const;

export const requestInfoOfferSchema = z.object({
  submissionId: z.string().uuid(),
  kind: offerKindEnum,
  offerId,
});

export const leadScopeSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
});

export const updateInfoOffersSchema = z.object({
  organizationId: z.string().uuid(),
  settings: infoOffersSettingsSchema,
});

export const setAttendanceSchema = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
  attended: z.boolean(),
});
