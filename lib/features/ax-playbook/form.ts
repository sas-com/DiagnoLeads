/**
 * Conversion between the stored playbook and the settings form.
 * Lists are edited as one item per line; table rows that are left entirely blank are dropped.
 */

import {
  AX_PLAYBOOK_CHALLENGES,
  type AxPlaybookChallenge,
  type AxPlaybookContent,
} from './types/schemas';

export interface AxPlaybookChallengeForm {
  effect: string;
  questions: string;
  signals: string;
}

export interface AxPlaybookForm {
  challenges: Record<AxPlaybookChallenge, AxPlaybookChallengeForm>;
  basicChecks: string;
  objections: AxPlaybookContent['objections'];
  ngPhrases: AxPlaybookContent['ngPhrases'];
  escalations: AxPlaybookContent['escalations'];
}

const toLines = (items: string[]) => items.join('\n');

const fromLines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const hasAnyText = (row: Record<string, string>) =>
  Object.values(row).some((value) => value.trim() !== '');

export function toAxPlaybookForm(content: AxPlaybookContent): AxPlaybookForm {
  const challenges = {} as Record<AxPlaybookChallenge, AxPlaybookChallengeForm>;
  for (const key of AX_PLAYBOOK_CHALLENGES) {
    const guide = content.challenges[key];
    challenges[key] = {
      effect: guide.effect,
      questions: toLines(guide.questions),
      signals: toLines(guide.signals),
    };
  }
  return {
    challenges,
    basicChecks: toLines(content.basicChecks),
    objections: content.objections.map((row) => ({ ...row })),
    ngPhrases: content.ngPhrases.map((row) => ({ ...row })),
    escalations: content.escalations.map((row) => ({ ...row })),
  };
}

/** Builds the content to save; the result still needs schema validation. */
export function fromAxPlaybookForm(form: AxPlaybookForm): AxPlaybookContent {
  const challenges = {} as AxPlaybookContent['challenges'];
  for (const key of AX_PLAYBOOK_CHALLENGES) {
    const guide = form.challenges[key];
    challenges[key] = {
      effect: guide.effect.trim(),
      questions: fromLines(guide.questions),
      signals: fromLines(guide.signals),
    };
  }
  return {
    challenges,
    basicChecks: fromLines(form.basicChecks),
    objections: form.objections.filter(hasAnyText),
    ngPhrases: form.ngPhrases.filter(hasAnyText),
    escalations: form.escalations.filter(hasAnyText),
  };
}
