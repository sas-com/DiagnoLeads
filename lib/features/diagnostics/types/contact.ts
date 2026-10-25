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

/** The contact a respondent sends with a diagnosis */
export const contactSchema = z.object({
  company: plainText(200).pipe(z.string().min(1)),
  name: plainText(100).pipe(z.string().min(1)),
  email: z.string().trim().email().max(254),
  phone: z
    .string()
    .max(30)
    .transform(normalizePhone)
    .pipe(z.string().regex(PHONE_PATTERN))
    .optional(),
});
