import type { DiagnosticAnswers } from '../types';

/**
 * Company size questions of the AX migration diagnosis and the "fits the target customer"
 * check (Refs #150).
 *
 * Only the answer ranges live in code. Which ranges the sales team targets is confidential
 * (this repository is public), so each organization picks them in the sales playbook settings.
 * The questions are optional: an unanswered or "I don't know" answer never excludes a company.
 */
export const AX_COMPANY_SIZE_OPTIONS = {
  /** Annual revenue in yen: under 1 billion (10億円), 1-3, 3-10, 10-30 and 30+ billion */
  annual_revenue: ['under_1b', '1b_3b', '3b_10b', '10b_30b', 'over_30b'],
  /** Same ranges as the employee count of the hearing sheet, so the hearing is prefilled */
  employees: ['lt50', '50_299', '300_999', 'gte1000'],
  /** Offices, plants and warehouses */
  sites: ['single', '2_4', '5_9', 'gte10'],
} as const;

export type AxCompanySizeQuestion = keyof typeof AX_COMPANY_SIZE_OPTIONS;
export const AX_COMPANY_SIZE_QUESTIONS = Object.keys(
  AX_COMPANY_SIZE_OPTIONS
) as AxCompanySizeQuestion[];

/** Ranges the organization targets per question; an empty list means "no condition" */
export type AxTargetCompany = Record<AxCompanySizeQuestion, string[]>;

export function emptyAxTargetCompany(): AxTargetCompany {
  return { annual_revenue: [], employees: [], sites: [] };
}

/**
 * - not_configured: the organization set no condition
 * - not_fit: an answered question is outside the target ranges
 * - unknown: nothing is outside, but a conditioned question is unanswered / "I don't know"
 * - fit: every conditioned question is answered within the target ranges
 */
export type AxCompanySizeFit = 'fit' | 'not_fit' | 'unknown' | 'not_configured';

export interface AxCompanySizeResult {
  fit: AxCompanySizeFit;
  /** Conditioned questions answered outside the target ranges */
  outside: AxCompanySizeQuestion[];
  /** Conditioned questions left unanswered or answered "I don't know" */
  unanswered: AxCompanySizeQuestion[];
}

export function evaluateCompanySize(
  answers: DiagnosticAnswers,
  target: AxTargetCompany | null
): AxCompanySizeResult {
  const outside: AxCompanySizeQuestion[] = [];
  const unanswered: AxCompanySizeQuestion[] = [];
  let conditioned = 0;

  for (const question of AX_COMPANY_SIZE_QUESTIONS) {
    const accepted = target?.[question] ?? [];
    if (accepted.length === 0) continue;
    conditioned++;
    const answer = answers[question];
    const known =
      typeof answer === 'string' &&
      (AX_COMPANY_SIZE_OPTIONS[question] as readonly string[]).includes(answer);
    if (!known) unanswered.push(question);
    else if (!accepted.includes(answer)) outside.push(question);
  }

  const fit: AxCompanySizeFit =
    conditioned === 0
      ? 'not_configured'
      : outside.length > 0
        ? 'not_fit'
        : unanswered.length > 0
          ? 'unknown'
          : 'fit';
  return { fit, outside, unanswered };
}
