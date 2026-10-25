/**
 * Which result category (ヒト／カネ／モノ／情報) each challenge answer counts toward. Kept apart
 * from the scoring (evaluate.ts) so the public result page can read it without shipping the
 * scoring code to the browser (architecture rule public-bundle-imports-scoring, #658).
 */
import { multiple } from '../engine';
import type { DiagnosticAnswers } from '../types';

/** The four result categories: ヒト／カネ／モノ／情報 */
export type ChallengeType = 'people' | 'cost' | 'agility' | 'data';

/** Challenge answers of the server-based paths map onto the four result categories */
export const SERVER_CHALLENGE_CATEGORY: Record<string, ChallengeType> = {
  people: 'people',
  blackbox: 'people',
  cost: 'cost',
  deadline: 'agility',
  agility: 'agility',
  remote: 'agility',
  data: 'data',
};

/** Access challenge answers map onto the four result categories */
export const ACCESS_CHALLENGE_CATEGORY: Record<string, ChallengeType> = {
  people: 'people',
  manual: 'cost',
  stability: 'agility',
  remote: 'agility',
  support: 'agility',
  data: 'data',
  // Records and permissions: how the data is managed
  audit: 'data',
};

/**
 * The challenge options the respondent chose that fall under one category, in question order.
 * The result shows them under the primary challenge, whose text is the pamphlet's and may not
 * match every answer (e.g. モノ when only the support deadline was chosen, #658).
 */
export function answeredChallengesIn(
  answers: DiagnosticAnswers,
  category: ChallengeType
): { questionId: 'challenges' | 'access_challenges'; value: string }[] {
  return [
    ...multiple(answers, 'challenges')
      .filter((value) => SERVER_CHALLENGE_CATEGORY[value] === category)
      .map((value) => ({ questionId: 'challenges' as const, value })),
    ...multiple(answers, 'access_challenges')
      .filter((value) => ACCESS_CHALLENGE_CATEGORY[value] === category)
      .map((value) => ({ questionId: 'access_challenges' as const, value })),
  ];
}
