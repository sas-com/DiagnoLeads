/**
 * What to ask next for the main challenge of an AX diagnosis lead (Refs #75): the sales
 * playbook's guide (#74) for the challenge the respondent chose first. Pure; the service reads
 * the lead and the playbook.
 */
import type { AxPlaybookContent } from '@/lib/features/ax-playbook/types/schemas';
import { PREP_CHALLENGES, type PrepChallenge } from '@/lib/features/lead-prep/types/schemas';

export interface ChallengeGuide {
  effect: string;
  questions: string[];
  signals: string[];
}

/** The diagnosis challenge key, or null when it is none of the four */
export const toChallenge = (value: unknown): PrepChallenge | null =>
  (PREP_CHALLENGES as readonly unknown[]).includes(value) ? (value as PrepChallenge) : null;

/** The playbook's guide for the challenge; null when nothing is written for it */
export function pickChallengeGuide(
  content: Pick<AxPlaybookContent, 'challenges'> | null,
  challenge: PrepChallenge | null
): ChallengeGuide | null {
  if (!content || !challenge) return null;
  const guide = content.challenges?.[challenge];
  if (!guide) return null;
  const effect = guide.effect?.trim() ?? '';
  const questions = guide.questions ?? [];
  const signals = guide.signals ?? [];
  if (!effect && questions.length === 0 && signals.length === 0) return null;
  return { effect, questions, signals };
}

/** At most this many characters of the effect go into a notification */
export const EFFECT_LINE_MAX = 80;

/**
 * One line of the effect for the sales notification: the first line, cut at EFFECT_LINE_MAX.
 * The rest of the playbook (questions, signals) never goes into a notification.
 */
export function effectLine(effect: string | null | undefined): string | null {
  const first = (effect ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!first) return null;
  return first.length > EFFECT_LINE_MAX ? `${first.slice(0, EFFECT_LINE_MAX - 1)}…` : first;
}
