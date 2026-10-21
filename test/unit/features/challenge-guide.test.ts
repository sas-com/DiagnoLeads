/**
 * What to ask next for the main challenge (#75): the playbook guide picked for each of the four
 * challenges and for none, the one line of effect for notifications, and that the sales
 * notification carries that line but no questions or signals. Playbook text is made up.
 */
import { emptyAxPlaybookContent } from '@/lib/features/ax-playbook/types/schemas';
import {
  EFFECT_LINE_MAX,
  effectLine,
  pickChallengeGuide,
  toChallenge,
} from '@/lib/features/challenge-guide/guide';
import { describe, expect, it } from 'vitest';

const content = () => {
  const c = emptyAxPlaybookContent();
  for (const key of ['people', 'cost', 'agility', 'data'] as const) {
    c.challenges[key] = {
      effect: `${key} の効果`,
      questions: [`${key} の質問1`, `${key} の質問2`],
      signals: [`${key} の合図`],
    };
  }
  return c;
};

describe('pickChallengeGuide', () => {
  it.each(['people', 'cost', 'agility', 'data'] as const)('picks the guide for %s', (key) => {
    expect(pickChallengeGuide(content(), key)).toEqual({
      effect: `${key} の効果`,
      questions: [`${key} の質問1`, `${key} の質問2`],
      signals: [`${key} の合図`],
    });
  });

  it('has nothing without a challenge, a playbook or a guide written for it', () => {
    expect(pickChallengeGuide(content(), null)).toBeNull();
    expect(pickChallengeGuide(null, 'people')).toBeNull();
    expect(pickChallengeGuide(emptyAxPlaybookContent(), 'people')).toBeNull();
  });

  it('reads only the four challenge keys', () => {
    expect(toChallenge('cost')).toBe('cost');
    expect(toChallenge('none')).toBeNull();
    expect(toChallenge(null)).toBeNull();
  });
});

describe('effectLine', () => {
  it('takes the first line, cut to the limit', () => {
    expect(effectLine('\n  保守費を下げる  \n詳しい説明')).toBe('保守費を下げる');
    const long = 'あ'.repeat(EFFECT_LINE_MAX + 5);
    const line = effectLine(long);
    expect(line).toHaveLength(EFFECT_LINE_MAX);
    expect(line?.endsWith('…')).toBe(true);
    expect(effectLine('  ')).toBeNull();
    expect(effectLine(undefined)).toBeNull();
  });
});
