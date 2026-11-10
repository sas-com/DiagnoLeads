import type { DiagnosticAnswers } from '../types';
import { AX_MIGRATION_CONFIG, type AxMigrationConfig } from './config';
import { ACCESS_DATA_KINDS_QUESTION } from './data-kinds';
import { axMigrationDefinition } from './definition';

/**
 * Data in an Access tool that sales must notice before the first consultation (#828): My Number,
 * personal data that needs special care and card or account numbers, chosen in the follow-up
 * question on the kinds of data (#826). Read on the server and in the notifications only; the
 * public diagnosis says no more than that the handling is decided together (#844, data-kinds.ts).
 */

/**
 * The flagged kinds among the answers, in the order the question lists them. Stored answers are
 * read as they are: anything but an object has none
 */
export function attentionDataKinds(
  answers: unknown,
  config: Pick<AxMigrationConfig, 'accessDataKindsToFlag'> = AX_MIGRATION_CONFIG
): string[] {
  const chosen =
    typeof answers === 'object' && answers !== null
      ? (answers as Record<string, unknown>)[ACCESS_DATA_KINDS_QUESTION]
      : undefined;
  if (!Array.isArray(chosen)) return [];
  return dataKindOptions()
    .map((option) => option.value)
    .filter((kind) => config.accessDataKindsToFlag.includes(kind) && chosen.includes(kind));
}

/** The summary kept on the lead, only once the question has been answered */
export function dataAttentionSummary(answers: DiagnosticAnswers): { dataAttention?: string[] } {
  return Object.hasOwn(answers, ACCESS_DATA_KINDS_QUESTION)
    ? { dataAttention: attentionDataKinds(answers) }
    : {};
}

/** The kinds in the words of the question (Japanese: the notifications are Japanese) */
export function dataKindLabels(kinds: readonly string[]): string[] {
  const options = dataKindOptions();
  return kinds.map((kind) => options.find((option) => option.value === kind)?.label.ja ?? kind);
}

function dataKindOptions() {
  return (
    axMigrationDefinition.questions.find((question) => question.id === ACCESS_DATA_KINDS_QUESTION)
      ?.options ?? []
  );
}
