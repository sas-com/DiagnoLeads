/**
 * upsertLeadFromSubmission (shared by the AX diagnosis and builder diagnoses, #116).
 * A fake transaction records the calls; the database behaviour (lock, concurrency) is covered by
 * the AX and builder DB integration tests.
 */
import {
  type SubmissionTransaction,
  upsertLeadFromSubmission,
} from '@/lib/features/diagnostics/lead-upsert';
import { describe, expect, it, vi } from 'vitest';

function fakeTx(existing: Record<string, unknown> | undefined) {
  const steps: string[] = [];
  const insertedValues: Record<string, unknown>[] = [];
  const tx = {
    execute: vi.fn(async () => {
      steps.push('lock');
    }),
    query: {
      leads: {
        findFirst: vi.fn(async () => {
          steps.push('find');
          return existing;
        }),
      },
    },
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => {
        steps.push('insert');
        insertedValues.push(values);
        return { returning: async () => [{ id: 'new-lead' }] };
      },
    })),
    update: vi.fn(),
  };
  return { tx: tx as unknown as SubmissionTransaction, raw: tx, steps, insertedValues };
}

const now = new Date('2026-10-16T01:00:00Z');
const input = {
  organizationId: 'org-1',
  email: 'Taro@Example.co.jp',
  newLead: { name: '試験 太郎', company: '架空商事', status: 'new', score: 40 },
  now,
};

describe('upsertLeadFromSubmission', () => {
  it('locks, looks up, then creates a lead with the given values and a lower-case email', async () => {
    const { tx, steps, insertedValues } = fakeTx(undefined);
    const result = await upsertLeadFromSubmission(tx, input);
    expect(result).toEqual({ leadId: 'new-lead', existing: undefined });
    expect(steps).toEqual(['lock', 'find', 'insert']);
    expect(insertedValues[0]).toEqual({
      name: '試験 太郎',
      company: '架空商事',
      status: 'new',
      score: 40,
      organizationId: 'org-1',
      email: 'taro@example.co.jp',
      createdAt: now,
      updatedAt: now,
    });
  });

  it('never writes to an existing lead (unauthenticated input)', async () => {
    const existing = { id: 'lead-old', name: '既存', company: '既存社', email: 'taro@example.co.jp' };
    const { tx, raw, steps } = fakeTx(existing);
    const result = await upsertLeadFromSubmission(tx, input);
    expect(result).toEqual({ leadId: 'lead-old', existing });
    expect(steps).toEqual(['lock', 'find']);
    expect(raw.insert).not.toHaveBeenCalled();
    expect(raw.update).not.toHaveBeenCalled();
  });

  it('the given values cannot override the organization, email or dates', async () => {
    const { tx, insertedValues } = fakeTx(undefined);
    await upsertLeadFromSubmission(tx, {
      ...input,
      newLead: {
        ...input.newLead,
        organizationId: 'other-org',
        email: 'x@y.z',
      } as unknown as typeof input.newLead,
    });
    expect(insertedValues[0]).toMatchObject({ organizationId: 'org-1', email: 'taro@example.co.jp' });
  });
});
