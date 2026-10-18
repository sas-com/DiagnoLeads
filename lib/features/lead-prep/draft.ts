/**
 * Draft of the pre-meeting prep card (Refs #156), from what is already known about the lead:
 * the Web diagnosis (system, challenges, the reasons behind the urgency and difficulty) and the
 * organization's sales playbook (#74: questions to dig deeper per challenge, the "what to ask
 * next" of #75). Pure: labels come from a translator so the screen's language is used. Only
 * empty fields are filled; what sales wrote is never overwritten.
 */
import {
  PREP_CHALLENGES,
  PREP_LIMITS,
  type PrepCardFields,
  type PrepChallenge,
} from './types/schemas';

export interface PrepDraftSource {
  /** Migration source of the lead (pipeline target system key), or null */
  targetSystem: string | null;
  /** Where the system came from: the diagnosis or the lead's own field */
  targetSystemFrom: 'diagnosis' | 'lead' | null;
  primaryChallenge: PrepChallenge | null;
  /** Challenges chosen in the diagnosis */
  challenges: PrepChallenge[];
  /** Reason keys of the latest AX diagnosis (axDiagnosis.result.reasons.*) */
  urgencyReasons: string[];
  difficultyReasons: string[];
  /** Playbook questions per challenge (empty when no playbook) */
  playbookQuestions: Partial<Record<PrepChallenge, string[]>>;
}

/** Looks up a message by its full key */
export type PrepTranslate = (key: string, values?: Record<string, string>) => string;

const isChallenge = (value: string | null): value is PrepChallenge =>
  value !== null && (PREP_CHALLENGES as readonly string[]).includes(value);

export const toPrepChallenge = (value: string | null | undefined): PrepChallenge | null =>
  isChallenge(value ?? null) ? (value as PrepChallenge) : null;

/** Whether there is anything to draft from */
export function hasDraftMaterial(source: PrepDraftSource): boolean {
  return (
    source.targetSystem !== null ||
    source.primaryChallenge !== null ||
    source.challenges.length > 0 ||
    Object.values(source.playbookQuestions).some((list) => (list?.length ?? 0) > 0)
  );
}

/** The first questions: the playbook's for the main challenge first, then the other chosen ones */
export function draftQuestions(source: PrepDraftSource): string[] {
  const order = [
    ...(source.primaryChallenge ? [source.primaryChallenge] : []),
    ...source.challenges.filter((c) => c !== source.primaryChallenge),
  ];
  const questions: string[] = [];
  for (const challenge of order) {
    for (const question of source.playbookQuestions[challenge] ?? []) {
      if (questions.length < PREP_LIMITS.questions && !questions.includes(question)) {
        questions.push(question.slice(0, PREP_LIMITS.question));
      }
    }
  }
  return questions;
}

/** Fill the empty fields of the card from the source */
export function buildPrepDraft(
  card: PrepCardFields,
  source: PrepDraftSource,
  t: PrepTranslate
): PrepCardFields {
  const next: PrepCardFields = {
    ...card,
    hypotheses: { ...card.hypotheses },
    firstQuestions: [...card.firstQuestions],
  };

  if (!next.estimatedSystem && source.targetSystem) {
    next.estimatedSystem = t(`pipeline.targetSystem.${source.targetSystem}`);
    if (!next.estimatedSystemBasis) {
      next.estimatedSystemBasis = t(
        source.targetSystemFrom === 'diagnosis'
          ? 'leadPrep.drafts.basisDiagnosis'
          : 'leadPrep.drafts.basisLead'
      );
    }
  }

  const reasons = [...source.urgencyReasons, ...source.difficultyReasons]
    .map((key) => t(`axDiagnosis.result.reasons.${key}`))
    .join('／');
  const chosen = [
    ...(source.primaryChallenge ? [source.primaryChallenge] : []),
    ...source.challenges.filter((c) => c !== source.primaryChallenge),
  ];
  for (const challenge of chosen) {
    if (next.hypotheses[challenge]) continue;
    const primary = challenge === source.primaryChallenge;
    next.hypotheses[challenge] =
      primary && reasons
        ? t('leadPrep.drafts.primaryWithReasons', { reasons })
        : t(primary ? 'leadPrep.drafts.primary' : 'leadPrep.drafts.selected');
  }

  if (next.firstQuestions.length === 0) next.firstQuestions = draftQuestions(source);
  return next;
}

/** Ready for the meeting: the three first questions are written (the prep target of #156) */
export const isPrepReady = (card: Pick<PrepCardFields, 'firstQuestions'>): boolean =>
  card.firstQuestions.filter((q) => q.trim()).length >= PREP_LIMITS.questions;
