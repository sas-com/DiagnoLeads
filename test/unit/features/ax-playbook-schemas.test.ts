/**
 * AX sales playbook content validation (Refs #74).
 */
import { describe, expect, it } from 'vitest';
import {
  AX_PLAYBOOK_LIMITS,
  axPlaybookContentSchema,
  emptyAxPlaybookContent,
} from '@/lib/features/ax-playbook/types/schemas';

describe('axPlaybookContentSchema', () => {
  it('accepts the empty playbook', () => {
    expect(axPlaybookContentSchema.safeParse(emptyAxPlaybookContent()).success).toBe(true);
  });

  it('trims text', () => {
    const content = emptyAxPlaybookContent();
    content.basicChecks = ['  item  '];
    expect(axPlaybookContentSchema.parse(content).basicChecks).toEqual(['item']);
  });

  it('rejects blank list items', () => {
    const content = emptyAxPlaybookContent();
    content.challenges.cost.questions = ['   '];
    expect(axPlaybookContentSchema.safeParse(content).success).toBe(false);
  });

  it('rejects text over the character limit', () => {
    const content = emptyAxPlaybookContent();
    content.challenges.data.effect = 'a'.repeat(AX_PLAYBOOK_LIMITS.textMax + 1);
    expect(axPlaybookContentSchema.safeParse(content).success).toBe(false);
  });

  it('rejects lists over the item limit', () => {
    const content = emptyAxPlaybookContent();
    content.ngPhrases = Array.from({ length: AX_PLAYBOOK_LIMITS.itemsMax + 1 }, () => ({
      ng: 'x',
      alternative: 'y',
    }));
    expect(axPlaybookContentSchema.safeParse(content).success).toBe(false);
  });

  it('requires both sides of an objection', () => {
    const content = emptyAxPlaybookContent();
    content.objections = [{ customer: 'C', response: '', note: '' }];
    expect(axPlaybookContentSchema.safeParse(content).success).toBe(false);
  });

  it('requires all four challenges', () => {
    const { challenges, ...rest } = emptyAxPlaybookContent();
    const { data: _data, ...threeChallenges } = challenges;
    expect(axPlaybookContentSchema.safeParse({ ...rest, challenges: threeChallenges }).success).toBe(
      false
    );
  });
});
