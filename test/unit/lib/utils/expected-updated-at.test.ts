/**
 * The bound of the `updatedAt` a client sends back with a save (#1240): every save that compares
 * it takes the same bound, at the input check.
 */
import { saveDiagnosisDraftSchema, publishDiagnosisSchema } from '@/lib/features/diagnosis-builder/types/schemas';
import { updateLeadHearingSchema } from '@/lib/features/lead-hearings/types/schemas';
import { savePrepCardSchema } from '@/lib/features/lead-prep/types/schemas';
import { EXPECTED_UPDATED_AT_MAX, expectedUpdatedAtSchema } from '@/lib/utils/expected-updated-at';
import { describe, expect, it } from 'vitest';

/** The last date JavaScript can hold: it has no next millisecond */
const LAST_DATE = new Date(8.64e15);

describe('the updatedAt a client sends back', () => {
  it('takes a date as it is read from a row, and the bound itself', () => {
    expect(expectedUpdatedAtSchema.safeParse(new Date('2026-11-19T01:02:03.456Z')).success).toBe(true);
    expect(expectedUpdatedAtSchema.safeParse(EXPECTED_UPDATED_AT_MAX).success).toBe(true);
  });

  it('refuses a date past the bound, one with no next millisecond, and one that is not a date', () => {
    expect(expectedUpdatedAtSchema.safeParse(new Date(EXPECTED_UPDATED_AT_MAX.getTime() + 1)).success).toBe(false);
    expect(expectedUpdatedAtSchema.safeParse(LAST_DATE).success).toBe(false);
    expect(expectedUpdatedAtSchema.safeParse(new Date(Number.NaN)).success).toBe(false);
    expect(expectedUpdatedAtSchema.safeParse('2026-11-19').success).toBe(false);
  });

  it('is the bound of every save that compares it', () => {
    const fields = [
      updateLeadHearingSchema.shape.expectedUpdatedAt,
      saveDiagnosisDraftSchema.shape.expectedUpdatedAt,
      publishDiagnosisSchema.shape.expectedUpdatedAt,
      savePrepCardSchema.shape.expectedUpdatedAt,
    ];
    for (const field of fields) expect(field.safeParse(LAST_DATE).success).toBe(false);
    // The prep card also takes null: no card was there when it was read
    expect(savePrepCardSchema.shape.expectedUpdatedAt.safeParse(null).success).toBe(true);
  });
});
