/**
 * Input of the activity timeline as the client really sends it (Refs #143)
 */
import { listLeadActivitiesSchema } from '@/lib/features/lead-activity/types/schemas';
import { describe, expect, it } from 'vitest';

const base = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  leadId: '22222222-2222-4222-8222-222222222222',
};

describe('listLeadActivitiesSchema', () => {
  it('accepts the direction that useInfiniteQuery adds', () => {
    expect(listLeadActivitiesSchema.safeParse({ ...base, direction: 'forward' }).success).toBe(
      true
    );
    expect(
      listLeadActivitiesSchema.safeParse({
        ...base,
        cursor: { at: '2026-10-16T00:00:00.000Z', id: 'x' },
        direction: 'forward',
      }).success
    ).toBe(true);
  });

  it('accepts the respondent email kinds as a filter (#154)', () => {
    expect(
      listLeadActivitiesSchema.safeParse({
        ...base,
        types: ['result_email_requested', 'result_email_sent', 'email_unsubscribed'],
      }).success
    ).toBe(true);
    expect(listLeadActivitiesSchema.safeParse({ ...base, types: ['email_sent'] }).success).toBe(
      false
    );
  });

  it('still rejects other unknown keys', () => {
    expect(listLeadActivitiesSchema.safeParse({ ...base, other: 1 }).success).toBe(false);
    expect(listLeadActivitiesSchema.safeParse({ ...base, direction: 'sideways' }).success).toBe(
      false
    );
  });
});
