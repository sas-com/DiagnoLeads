/**
 * Contact fields of the public diagnoses (the AX diagnosis and the diagnoses made in the
 * builder), shared by the forms (browser) and the API (server), #481
 */
import { PLAIN_TEXT } from '@/lib/utils/plain-text';
import { z } from 'zod';

/** Full-width digits and long-vowel dashes typed with a Japanese IME still make a phone number */
export const normalizePhone = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/[ー‐‑–—―−]/g, '-')
    .trim();

export const PHONE_PATTERN = /^[0-9+\-() ]*$/;

export const plainText = (max: number) => z.string().trim().max(max).regex(PLAIN_TEXT);

/**
 * Longest phone number, counted after normalizePhone, as NFKC can make it longer ("⑴" becomes
 * "(1)"). The same as the lead's own limit (LEAD_TEXT_MAX_LENGTH.phone, #575): a longer number
 * saved here could not be saved again from the lead page (#619)
 */
export const PHONE_MAX_LENGTH = 30;

/**
 * Longest phone input before normalizePhone, so a huge input is refused before NFKC runs. Kept
 * well above PHONE_MAX_LENGTH: a valid number can be longer before NFKC than after it (a digit
 * outside the BMP such as "𝟎" is two UTF-16 units and becomes "0"), at most 60 units plus the
 * spaces around it that normalizePhone trims
 */
export const PHONE_INPUT_MAX_LENGTH = 100;

/** Longest company, name and email, counted after trim */
export const CONTACT_MAX_LENGTH = { company: 200, name: 100, email: 254 } as const;

/** The contact a respondent sends with a diagnosis */
export const contactSchema = z.object({
  company: plainText(CONTACT_MAX_LENGTH.company).pipe(z.string().min(1)),
  name: plainText(CONTACT_MAX_LENGTH.name).pipe(z.string().min(1)),
  email: z.string().trim().email().max(CONTACT_MAX_LENGTH.email),
  phone: z
    .string()
    .max(PHONE_INPUT_MAX_LENGTH)
    .transform(normalizePhone)
    .pipe(z.string().max(PHONE_MAX_LENGTH).regex(PHONE_PATTERN))
    .optional(),
});

/**
 * The limit a contact field goes over, counted as contactSchema counts it (after trim, the phone
 * also after normalizePhone), or null within it. The forms name it under the field before
 * sending: the API's 400 for it cannot be tied to a field (#714)
 */
export function contactOverLimit(
  field: keyof typeof CONTACT_MAX_LENGTH | 'phone',
  value: string
): number | null {
  const trimmed = value.trim();
  if (field === 'phone') {
    const over =
      trimmed.length > PHONE_INPUT_MAX_LENGTH || normalizePhone(trimmed).length > PHONE_MAX_LENGTH;
    return over ? PHONE_MAX_LENGTH : null;
  }
  return trimmed.length > CONTACT_MAX_LENGTH[field] ? CONTACT_MAX_LENGTH[field] : null;
}
