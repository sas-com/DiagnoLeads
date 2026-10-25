import { PLAIN_TEXT } from '@/lib/utils/plain-text';
import { z } from 'zod';

/**
 * Diagnosis links issued to sales agencies (Refs #147).
 * The kind is the inflow source given to a lead created through the link.
 */
export const AGENCY_LINK_KINDS = ['telemarketing_agency', 'referral_agency'] as const;
export const agencyLinkKindEnum = z.enum(AGENCY_LINK_KINDS);
export type AgencyLinkKind = z.infer<typeof agencyLinkKindEnum>;
/**
 * Kinds stored in agency_links: the agency kinds issued from the settings, and the employee's own
 * link issued from the customer search screen (#265)
 */
export const MEMBER_REFERRAL_KIND = 'member_referral' as const;
export type AnyLinkKind = AgencyLinkKind | typeof MEMBER_REFERRAL_KIND;

/** Lowercase letters and digits without look-alikes (0/o, 1/l/i), so a code read aloud survives */
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const AGENCY_CODE_LENGTH = 12;
export const AGENCY_CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${AGENCY_CODE_LENGTH}}$`);

/** Random code for a new link: 31^12 (about 2^59) values, so codes cannot be guessed */
export function generateAgencyCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(AGENCY_CODE_LENGTH * 2));
  let code = '';
  for (const byte of bytes) {
    // Rejection sampling keeps every letter equally likely
    if (byte >= 256 - (256 % CODE_ALPHABET.length)) continue;
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    if (code.length === AGENCY_CODE_LENGTH) return code;
  }
  return generateAgencyCode();
}

/** Link to the AX diagnosis that carries the agency code */
export function buildAgencyLinkUrl(origin: string, locale: string, code: string): string {
  const url = new URL(`/${locale}/ax-diagnosis`, origin);
  url.searchParams.set('agency', code);
  return url.toString();
}

export const listAgencyLinksSchema = z.object({
  organizationId: z.string().uuid(),
});

export const createAgencyLinkSchema = z.object({
  organizationId: z.string().uuid(),
  agencyName: z.string().trim().min(1).max(200).regex(PLAIN_TEXT),
  kind: agencyLinkKindEnum,
  campaign: z
    .string()
    .trim()
    .max(100)
    .regex(PLAIN_TEXT)
    .transform((value) => value || null)
    .nullable()
    .optional(),
});
export type CreateAgencyLinkInput = z.infer<typeof createAgencyLinkSchema>;

export const setAgencyLinkActiveSchema = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
  active: z.boolean(),
});
