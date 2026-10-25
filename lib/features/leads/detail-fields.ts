/**
 * Which lead fields each card of the lead page shows and edits (Refs #107, #109)
 *
 * The page shows only fields with a value; the empty ones are counted into one line per card
 * ("未設定 n 件・入力する"), which opens that card for editing at the first empty field.
 */
import type { LeadStatus } from './types/pipeline';

/** Tabs of the lead page, kept in the URL (?tab=) */
export const LEAD_TABS = ['overview', 'hearings', 'activity', 'diagnosis'] as const;
export type LeadTab = (typeof LEAD_TABS)[number];
export const isLeadTab = (value: unknown): value is LeadTab =>
  typeof value === 'string' && (LEAD_TABS as readonly string[]).includes(value);

export const LEAD_CARDS = ['contact', 'inflow', 'pipeline'] as const;
export type LeadCardId = (typeof LEAD_CARDS)[number];

export const LEAD_CARD_FIELDS = {
  contact: ['name', 'company', 'email', 'phone'],
  inflow: ['inflowSource', 'agencyName', 'acquisitionCost', 'referrerName', 'conversionPoint'],
  // The score is the reason of the MQL level, shown on the diagnosis card (#447)
  pipeline: ['dealPhase', 'targetSystem', 'mqlQualified', 'sqlDecision', 'lostReason'],
} as const satisfies Record<LeadCardId, readonly string[]>;

export type LeadCardField = (typeof LEAD_CARD_FIELDS)[LeadCardId][number];

/** The lead values the cards read */
export interface LeadFieldValues {
  status: string;
  name: string | null;
  company: string | null;
  email: string;
  phone: string | null;
  inflowSource: string | null;
  agencyName: string | null;
  acquisitionCost: number | null;
  referrerName: string | null;
  conversionPoint: string | null;
  dealPhase: string | null;
  targetSystem: string | null;
  mqlQualifiedAt: Date | string | null;
  sqlDecision: string | null;
  lostReason: string | null;
}

export const isLeadCardId = (value: unknown): value is LeadCardId =>
  typeof value === 'string' && (LEAD_CARDS as readonly string[]).includes(value);

/** The card a field belongs to (null for fields no card edits) */
export function cardOfField(field: string): LeadCardId | null {
  for (const card of LEAD_CARDS) {
    if ((LEAD_CARD_FIELDS[card] as readonly string[]).includes(field)) return card;
  }
  return null;
}

/** Lost / on-hold reason matters for a lost lead, and for a nurtured one put on hold (#445) */
export const showsLostReason = (status: string): boolean =>
  status === ('lost' satisfies LeadStatus) || status === ('nurturing' satisfies LeadStatus);

/** Fields the card shows for this lead (lostReason only when the lead is lost or nurtured) */
export function cardFields(
  card: LeadCardId,
  lead: Pick<LeadFieldValues, 'status'>
): LeadCardField[] {
  return LEAD_CARD_FIELDS[card].filter(
    (field) => field !== 'lostReason' || showsLostReason(lead.status)
  );
}

/** Whether a field has a value to show */
export function hasFieldValue(lead: LeadFieldValues, field: LeadCardField): boolean {
  switch (field) {
    case 'mqlQualified':
      return lead.mqlQualifiedAt !== null && lead.mqlQualifiedAt !== undefined;
    case 'acquisitionCost':
      return typeof lead[field] === 'number';
    default: {
      const value = lead[field];
      return typeof value === 'string' && value.trim() !== '';
    }
  }
}

/** The card's fields split into those with a value and the empty ones, in display order */
export function splitCardFields(
  card: LeadCardId,
  lead: LeadFieldValues
): { filled: LeadCardField[]; empty: LeadCardField[] } {
  const fields = cardFields(card, lead);
  return {
    filled: fields.filter((field) => hasFieldValue(lead, field)),
    empty: fields.filter((field) => !hasFieldValue(lead, field)),
  };
}
