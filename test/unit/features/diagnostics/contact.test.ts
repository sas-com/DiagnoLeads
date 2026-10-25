/**
 * #619: the phone number of a public diagnosis is counted after normalizePhone (NFKC), in both
 * schemas that take the shared contact fields (lib/features/diagnostics/types/contact.ts, #481):
 * the AX diagnosis and the diagnoses made in the builder.
 */
import { diagnosisSubmissionSchema } from '@/lib/features/diagnosis-builder/submission-service';
import { axMigrationSubmissionSchema } from '@/lib/features/diagnostics/ax-migration/submission-service';
import { PHONE_INPUT_MAX_LENGTH, PHONE_MAX_LENGTH } from '@/lib/features/diagnostics/types/contact';
import { LEAD_TEXT_MAX_LENGTH } from '@/lib/features/leads/types/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

const contact = { company: '架空商事', name: '試験 太郎', email: 'taro@example.co.jp' };

type Parsed = z.SafeParseReturnType<unknown, { contact: { phone?: string } }>;

const schemas: { name: string; parse: (phone: string) => Parsed }[] = [
  {
    name: 'the AX diagnosis (axMigrationSubmissionSchema)',
    parse: (phone) =>
      axMigrationSubmissionSchema.safeParse({
        answers: {},
        contact: { ...contact, phone },
        privacyConsent: true,
      }),
  },
  {
    name: 'the builder (diagnosisSubmissionSchema)',
    parse: (phone) =>
      diagnosisSubmissionSchema.safeParse({
        versionId: '0b6f4c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e',
        answers: {},
        contact: { ...contact, phone },
        privacyConsent: true,
        consentVersion: '2026-10-01',
      }),
  },
];

/**
 * Every issue of the parse, not only the phone's, so a failure of another field fails the test
 * as well. The form and the API read the phone's at contact.phone
 */
const allIssues = (result: Parsed) =>
  result.success
    ? []
    : result.error.issues.map(({ path, code, ...rest }) => ({
        path,
        code,
        maximum: 'maximum' in rest ? rest.maximum : undefined,
      }));

/** "⑴" (U+2474) is one character and becomes "(1)", three, under NFKC */
const PARENTHESIZED_ONE = '⑴';
/** "𝟎" (U+1D7CE) is two UTF-16 units and becomes "0", one, under NFKC */
const MATH_BOLD_ZERO = '\u{1D7CE}';

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(schemas)('the phone number of $name (#619)', ({ parse }) => {
  it('keeps a number typed with a Japanese IME, normalized', () => {
    const result = parse('０３ー１２３４ー５６７８');
    expect(result.success && result.data.contact.phone).toBe('03-1234-5678');
  });

  it('refuses 30 "⑴", which are 90 characters after NFKC, at contact.phone', () => {
    const result = parse(PARENTHESIZED_ONE.repeat(30));
    expect(allIssues(result)).toEqual([
      { path: ['contact', 'phone'], code: 'too_big', maximum: PHONE_MAX_LENGTH },
    ]);
  });

  it('accepts a number that is exactly 30 characters after normalization', () => {
    // 10 characters typed, 30 after NFKC
    const result = parse(PARENTHESIZED_ONE.repeat(10));
    expect(result.success && result.data.contact.phone).toBe('(1)'.repeat(10));
    expect('(1)'.repeat(10)).toHaveLength(PHONE_MAX_LENGTH);
  });

  it('refuses a number that is 31 characters after normalization', () => {
    const result = parse(`${PARENTHESIZED_ONE.repeat(10)}1`);
    expect(allIssues(result)).toEqual([
      { path: ['contact', 'phone'], code: 'too_big', maximum: PHONE_MAX_LENGTH },
    ]);
  });

  it('accepts a number longer before normalization, up to the bound before NFKC', () => {
    // 20 + 60 + 20 = 100 UTF-16 units typed; 30 digits once NFKC and trim have run
    const typed = `${' '.repeat(20)}${MATH_BOLD_ZERO.repeat(30)}${'　'.repeat(20)}`;
    expect(typed).toHaveLength(PHONE_INPUT_MAX_LENGTH);
    const result = parse(typed);
    expect(result.success && result.data.contact.phone).toBe('0'.repeat(30));
  });

  it('refuses an input over the bound before normalization without running NFKC', () => {
    const normalize = vi.spyOn(String.prototype, 'normalize');
    const result = parse(`${' '.repeat(PHONE_INPUT_MAX_LENGTH - 9)}0312345678`);
    expect(allIssues(result)).toEqual([
      { path: ['contact', 'phone'], code: 'too_big', maximum: PHONE_INPUT_MAX_LENGTH },
    ]);
    expect(normalize).not.toHaveBeenCalled();
  });

  it('refuses a huge input before NFKC as well', () => {
    const normalize = vi.spyOn(String.prototype, 'normalize');
    const result = parse(PARENTHESIZED_ONE.repeat(10_000));
    expect(allIssues(result)).toEqual([
      { path: ['contact', 'phone'], code: 'too_big', maximum: PHONE_INPUT_MAX_LENGTH },
    ]);
    expect(normalize).not.toHaveBeenCalled();
    // The spy does see NFKC when it runs
    parse('03-1234-5678');
    expect(normalize).toHaveBeenCalledWith('NFKC');
  });

  it('still refuses a number with letters at contact.phone', () => {
    const result = parse('03-1234-5678 内線12');
    expect(allIssues(result)).toEqual([
      { path: ['contact', 'phone'], code: 'invalid_string', maximum: undefined },
    ]);
  });
});

describe('the phone limit of the public diagnoses', () => {
  it('is the limit of the phone the lead keeps (#575)', () => {
    expect(PHONE_MAX_LENGTH).toBe(LEAD_TEXT_MAX_LENGTH.phone);
  });
});
