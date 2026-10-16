import { applicableQuestions } from '../engine';
import type { DiagnosticAnswers, DiagnosticQuestion } from '../types';
import { axMigrationDefinition } from './definition';

/**
 * Which answers describe the system itself. No scoring here: the result screen uses it in the
 * browser, while the weights stay on the server (evaluate.ts).
 */

/** Questions that only describe the respondent or their plans (not the system) */
const NON_TECHNICAL = new Set([
  'platform',
  'challenges',
  'access_challenges',
  'timeline',
  'industry',
  'role',
  'annual_revenue',
  'employees',
  'sites',
]);

/** Required questions about the system itself on the chosen path */
export function technicalQuestions(answers: DiagnosticAnswers): DiagnosticQuestion[] {
  return applicableQuestions(axMigrationDefinition, answers).filter(
    (q) => q.required && !NON_TECHNICAL.has(q.id)
  );
}

/**
 * Technical questions answered "I don't know": what to check in-house (or in the hearing)
 * to sharpen the estimate. "I don't know" next to known choices still tells something, so it
 * does not count.
 */
export function unknownTechnicalQuestions(answers: DiagnosticAnswers): DiagnosticQuestion[] {
  return technicalQuestions(answers).filter((q) => {
    const value = answers[q.id];
    return Array.isArray(value)
      ? value.length > 0 && value.every((v) => v === 'unknown')
      : value === 'unknown';
  });
}
