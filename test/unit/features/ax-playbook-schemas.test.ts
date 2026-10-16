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
  it('reads a playbook saved before #150 as having no target company size', () => {
    const { targetCompany: _omit, ...saved } = emptyAxPlaybookContent();
    expect(axPlaybookContentSchema.parse(saved).targetCompany).toEqual({
      annual_revenue: [],
      employees: [],
      sites: [],
    });
  });

  it('keeps the target ranges in the order of the question, once each', () => {
    const content = emptyAxPlaybookContent();
    content.targetCompany.annual_revenue = ['3b_10b', '1b_3b', '3b_10b'];
    expect(axPlaybookContentSchema.parse(content).targetCompany.annual_revenue).toEqual([
      '1b_3b',
      '3b_10b',
    ]);
  });

  it('rejects a target range the question does not offer', () => {
    const content = emptyAxPlaybookContent();
    content.targetCompany.sites = ['unknown'];
    expect(axPlaybookContentSchema.safeParse(content).success).toBe(false);
  });

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
