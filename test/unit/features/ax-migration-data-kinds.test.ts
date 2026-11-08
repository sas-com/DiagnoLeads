import {
  ACCESS_DATA_KINDS_QUESTION,
  ACCESS_DATA_KINDS_TO_DISCUSS,
  holdsDataToDiscuss,
} from '@/lib/features/diagnostics/ax-migration/data-kinds';
import { axMigrationDefinition } from '@/lib/features/diagnostics/ax-migration/definition';
import { accessAnswers } from '@/test/fixtures/ax-migration';
import { describe, expect, it } from 'vitest';

/** Choices that name no personal or confidential data */
const NOT_TO_DISCUSS = ['none', 'unknown'];

describe('holdsDataToDiscuss (#844)', () => {
  const question = axMigrationDefinition.questions.find((q) => q.id === ACCESS_DATA_KINDS_QUESTION);

  it('is the optional follow-up of the Access path (#826)', () => {
    expect(question?.detail).toBe(true);
    expect(question?.type).toBe('multiple');
  });

  it('decides on every choice of the question, so a new one is never left out silently', () => {
    const values = question?.options.map((option) => option.value) ?? [];
    expect(values.length).toBeGreaterThan(0);
    expect([...ACCESS_DATA_KINDS_TO_DISCUSS, ...NOT_TO_DISCUSS].sort()).toEqual([...values].sort());
  });

  it.each(['customer', 'employee', 'sensitive', 'my_number', 'payment', 'confidential'])(
    'is true for personal or confidential data: %s',
    (kind) => {
      expect(holdsDataToDiscuss({ ...accessAnswers, access_data_kinds: [kind] })).toBe(true);
      // "I don't know" next to a kind that is known still counts
      expect(holdsDataToDiscuss({ ...accessAnswers, access_data_kinds: [kind, 'unknown'] })).toBe(
        true
      );
    }
  );

  it('is false without personal or confidential data, or without an answer', () => {
    expect(holdsDataToDiscuss({ ...accessAnswers, access_data_kinds: ['none'] })).toBe(false);
    expect(holdsDataToDiscuss({ ...accessAnswers, access_data_kinds: ['unknown'] })).toBe(false);
    expect(holdsDataToDiscuss({ ...accessAnswers, access_data_kinds: [] })).toBe(false);
    expect(holdsDataToDiscuss(accessAnswers)).toBe(false);
  });
});
