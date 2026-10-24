/**
 * "When to act" (Refs #151). Pure functions on months ('YYYY-MM').
 *
 * 1. Deadline: the earliest of the dates that force a move, the unknown ones ignored:
 *    - the hardware support end of the latest hearing, else an estimate from the diagnosis
 *      answer (support_end) counted from the day of the diagnosis
 *    - the earliest retirement of the person who keeps the system (hearing)
 * 2. Start: the deadline minus the months a migration takes (organization setting).
 * 3. With the fiscal year end month known, the start moves back to the last budget planning
 *    month (BUDGET_PLANNING_MONTHS_BEFORE_FY_END before the fiscal year end) not after it:
 *    without a budget the start does not happen.
 * 4. The assignee is told noticeMonths before (a next action due on the 1st of that month).
 */
import { type ActTimingSettings, BUDGET_PLANNING_MONTHS_BEFORE_FY_END } from './types/schemas';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type ActDeadlineSource = 'supportEnd' | 'diagnosisSupportEnd' | 'retirement';

export interface ActTimingInput {
  /** Hearing: hardware support end, 'YYYY-MM' */
  hardwareSupportEnd?: string | null;
  /** Hearing: earliest retirement of the person who keeps the system, 'YYYY-MM' */
  earliestRetirement?: string | null;
  /** Hearing: fiscal year end month, 1-12 */
  fiscalYearEndMonth?: number | null;
  /** Diagnosis: the support_end answer and the day it was given ('YYYY-MM-DD') */
  diagnosisSupportEnd?: { answer: string; answeredOn: string } | null;
}

export interface ActTiming {
  /** 'YYYY-MM' */
  actBy: string;
  deadline: { month: string; source: ActDeadlineSource };
  /** The start before moving it to the budget planning */
  start: string;
  /** The budget planning month it was moved to, when the fiscal year end is known */
  budgetPlanning: string | null;
  /** First day the assignee is told, 'YYYY-MM-DD' */
  noticeOn: string;
}

const toIndex = (month: string) => {
  const [, year, mon] = MONTH.exec(month) as RegExpExecArray;
  return Number(year) * 12 + Number(mon) - 1;
};
const fromIndex = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;

export const isMonth = (value: unknown): value is string =>
  typeof value === 'string' && MONTH.test(value);

/** A month moved by some months */
export const addMonths = (month: string, months: number) => fromIndex(toIndex(month) + months);

/**
 * Whether "when to act" (the 1st of a month) still lies ahead of a Japan day: this month or later.
 * A past month brings nobody back: its next action was done or removed and is not made again
 * (#446)
 */
export const actByAhead = (actBy: string | null | undefined, today: string): boolean =>
  !!actBy && actBy >= `${today.slice(0, 7)}-01`;

/**
 * The diagnosis answer as a month: where the range is open, its middle (within a year: in 6
 * months; 1-3 years: in 2 years); already ended: the month of the diagnosis. Beyond 3 years, no
 * machine of their own and unknown give nothing.
 */
const DIAGNOSIS_SUPPORT_END_MONTHS: Record<string, number> = {
  passed: 0,
  within_1y: 6,
  '1_3y': 24,
};

export function diagnosisSupportEndMonth(
  answer: { answer: string; answeredOn: string } | null | undefined
): string | null {
  if (!answer) return null;
  const months = DIAGNOSIS_SUPPORT_END_MONTHS[answer.answer];
  const month = answer.answeredOn.slice(0, 7);
  return months === undefined || !isMonth(month) ? null : addMonths(month, months);
}

/** The last budget planning month not after `month`, for a fiscal year ending in `fyEndMonth` */
export function budgetPlanningMonth(month: string, fyEndMonth: number): string {
  const planningMonth = ((fyEndMonth - 1 - BUDGET_PLANNING_MONTHS_BEFORE_FY_END + 12) % 12) + 1;
  const index = toIndex(month);
  const back = ((((index % 12) + 1 - planningMonth) % 12) + 12) % 12;
  return fromIndex(index - back);
}

export function computeActTiming(
  input: ActTimingInput,
  settings: ActTimingSettings
): ActTiming | null {
  const candidates: { month: string; source: ActDeadlineSource }[] = [];
  if (isMonth(input.hardwareSupportEnd)) {
    candidates.push({ month: input.hardwareSupportEnd, source: 'supportEnd' });
  } else {
    const estimate = diagnosisSupportEndMonth(input.diagnosisSupportEnd);
    if (estimate) candidates.push({ month: estimate, source: 'diagnosisSupportEnd' });
  }
  if (isMonth(input.earliestRetirement)) {
    candidates.push({ month: input.earliestRetirement, source: 'retirement' });
  }
  if (candidates.length === 0) return null;
  // The earliest wins; on a tie the hearing's support end comes first (pushed first)
  const deadline = candidates.reduce((earliest, candidate) =>
    candidate.month < earliest.month ? candidate : earliest
  );

  const start = addMonths(deadline.month, -settings.migrationMonths);
  const fyEnd = input.fiscalYearEndMonth;
  const budgetPlanning =
    typeof fyEnd === 'number' && Number.isInteger(fyEnd) && fyEnd >= 1 && fyEnd <= 12
      ? budgetPlanningMonth(start, fyEnd)
      : null;
  const actBy = budgetPlanning ?? start;
  return {
    actBy,
    deadline,
    start,
    budgetPlanning,
    noticeOn: `${addMonths(actBy, -settings.noticeMonths)}-01`,
  };
}
