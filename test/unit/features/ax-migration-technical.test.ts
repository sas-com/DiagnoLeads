import {
  agilityAnswer,
  unknownTechnicalQuestions,
} from '@/lib/features/diagnostics/ax-migration/technical';
import { accessAnswers, as400Answers } from '@/test/fixtures/ax-migration';
import { describe, expect, it } from 'vitest';

describe('unknownTechnicalQuestions', () => {
  it('lists the technical questions answered "I don\'t know", in question order', () => {
    const ids = unknownTechnicalQuestions({
      ...as400Answers,
      source_docs: 'unknown',
      maintenance: 'unknown',
      as400_languages: ['unknown'],
    }).map((q) => q.id);
    expect(ids).toEqual(['maintenance', 'as400_languages', 'source_docs']);
  });

  it('ignores the respondent, their plans and the optional follow-ups', () => {
    expect(
      unknownTechnicalQuestions({ ...as400Answers, timeline: 'undecided', gaiji: 'unknown' })
    ).toEqual([]);
  });

  it('does not count "I don\'t know" picked together with what is known', () => {
    expect(
      unknownTechnicalQuestions({ ...accessAnswers, access_features: ['vba', 'unknown'] })
    ).toEqual([]);
    const ids = unknownTechnicalQuestions({
      ...accessAnswers,
      access_features: ['unknown'],
    }).map((q) => q.id);
    expect(ids).toEqual(['access_features']);
  });
});

describe('agilityAnswer (#658)', () => {
  it('keeps the brochure wording when agility itself was chosen', () => {
    expect(agilityAnswer({ ...as400Answers, challenges: ['agility', 'deadline'] })).toBeNull();
  });

  it('speaks to the other answers that count as agility, in a fixed order', () => {
    expect(agilityAnswer({ ...as400Answers, challenges: ['remote', 'deadline'] })).toBe('deadline');
    expect(agilityAnswer({ ...as400Answers, challenges: ['remote'] })).toBe('remote');
    expect(agilityAnswer({ ...accessAnswers, access_challenges: ['support', 'stability'] })).toBe(
      'stability'
    );
    expect(agilityAnswer({ ...accessAnswers, access_challenges: ['support'] })).toBe('support');
    expect(agilityAnswer({ ...accessAnswers, access_challenges: ['remote'] })).toBe('remote');
  });

  it('is null when no answer counts as agility', () => {
    expect(agilityAnswer({ ...as400Answers, challenges: ['people'] })).toBeNull();
    expect(agilityAnswer({ ...accessAnswers, access_challenges: ['people'] })).toBeNull();
    expect(agilityAnswer({})).toBeNull();
  });
});
