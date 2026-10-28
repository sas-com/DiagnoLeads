import {
  CALL_RESULTS,
  CLOSED_PROSPECT_NEXT_STEPS,
  CLOSED_PROSPECT_STAGES,
  type CallResult,
  PROSPECT_ENTRIES,
  PROSPECT_FUNNEL_STAGES,
  PROSPECT_STAGES,
  type ProspectEntry,
  type ProspectFunnelStage,
  type ProspectStage,
  REFUSAL_REASONS,
  type RefusalReason,
} from './types/schemas';

/**
 * The summary of the prospect list (#265), with the same definitions as the spreadsheet's
 * "summary for management" sheet so the numbers do not change when the list moves here.
 *
 * A row that became a lead keeps the stage it had, and nobody changes it any more: the lead and
 * its deals are followed from then on. So what is counted by stage leaves those rows out and
 * counts them apart as converted, while what was done (rows written, reactions, next steps,
 * meetings, calls) counts every row. The checks count the rows the list's filters show (decision
 * 2026-10-28-consolidate-input-places, #852).
 */

export interface SummaryProspect {
  contactedOn: string;
  entry: string;
  reaction: string | null;
  nextStep: string | null;
  nextActionOn: string | null;
  /** A rough time instead of a date; counts as entered, as text does in the spreadsheet */
  nextActionNote: string | null;
  stage: string | null;
  meetingOn: string | null;
  /** The lead the row became. Required, so that a query that does not read it fails to compile */
  leadId: string | null;
  /** A sales agency's call (#161) */
  callResult?: string | null;
  refusalReason?: string | null;
}

export interface MeetingTarget {
  /** First day of the month */
  month: string;
  /** Running total of meetings aimed at by the end of the month */
  meetings: number;
}

interface EntryRow {
  entry: ProspectEntry;
  total: number;
  hasIssue: number;
  handOver: number;
  meetings: number;
  /** Rows that became a lead */
  converted: number;
  /** contracts and byStage leave out the rows that became a lead */
  contracts: number;
  byStage: Record<ProspectStage, number>;
}

export interface ProspectSummary {
  overall: {
    total: number;
    hasIssue: number;
    handOver: number;
    keepChecking: number;
    meetings: number;
    /** Rows that became a lead: followed as the lead and its deals from then on */
    converted: number;
    /** contracts and nurturing leave out the rows that became a lead */
    contracts: number;
    nurturing: number;
    passed: number;
  };
  /** stages and withStage leave out the rows that became a lead */
  stages: {
    stage: ProspectStage;
    current: number;
    /** Share of the rows that have a stage */
    share: number;
    /** Rows at this stage or a later one (funnel stages only) */
    reached: number | null;
    /** reached / reached of the stage before (from the second funnel stage) */
    progressRate: number | null;
  }[];
  withStage: number;
  entries: EntryRow[];
  months: {
    month: string;
    recorded: number;
    meetings: number;
    meetingsToDate: number;
    target: number | null;
    /** meetingsToDate - target */
    gap: number | null;
  }[];
  /** The rows the list's filters show, so that both give the same counts */
  checks: {
    stageWithoutNextAction: number;
    overdue: number;
    handOverWithoutStage: number;
  };
  /** Calls of sales agencies (#161): the results and why calls were turned down */
  calls: {
    total: number;
    byResult: Record<CallResult, number>;
    refusals: Record<RefusalReason, number>;
  };
}

const isFunnelStage = (stage: string | null): stage is ProspectFunnelStage =>
  (PROSPECT_FUNNEL_STAGES as readonly string[]).includes(stage ?? '');

const funnelIndex = (stage: string | null) =>
  isFunnelStage(stage) ? PROSPECT_FUNNEL_STAGES.indexOf(stage) : -1;

const ratio = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);

const isOneOf = (values: readonly string[], value: string | null) =>
  value !== null && values.includes(value);

/** A row that became a lead (#852) */
const isConverted = (row: SummaryProspect) => row.leadId !== null;

/**
 * A row still followed: not a lead yet, not passed, not dropped or contracted. The same rows as
 * notClosed in api/router.ts, which filters the list in SQL; change both together
 */
const isFollowed = (row: SummaryProspect) =>
  !isConverted(row) &&
  !isOneOf(CLOSED_PROSPECT_NEXT_STEPS, row.nextStep) &&
  !isOneOf(CLOSED_PROSPECT_STAGES, row.stage);

/**
 * A followed row whose next action can be overdue: calls turned down are followed in the
 * re-approach list instead (#161). The same rows as openRow in api/router.ts
 */
const isOpenRow = (row: SummaryProspect) => isFollowed(row) && row.callResult !== 'refused';

const emptyStages = () =>
  Object.fromEntries(PROSPECT_STAGES.map((stage) => [stage, 0])) as Record<ProspectStage, number>;

/** First day of the month of an ISO date */
export const monthOf = (isoDate: string) => `${isoDate.slice(0, 7)}-01`;

function nextMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, '0')}-01`;
}

/**
 * @param today ISO date in Japan time; a next action before it is overdue
 */
export function summarizeProspects(
  rows: readonly SummaryProspect[],
  targets: readonly MeetingTarget[],
  today: string
): ProspectSummary {
  const count = (test: (row: SummaryProspect) => boolean) => rows.filter(test).length;
  // What is counted by stage: the rows that became a lead keep a stage nobody changes any more
  const staged = rows.filter((row) => !isConverted(row));
  const countStaged = (test: (row: SummaryProspect) => boolean) => staged.filter(test).length;

  const overall = {
    total: rows.length,
    hasIssue: count((row) => row.reaction === 'has_issue'),
    handOver: count((row) => row.nextStep === 'hand_over'),
    keepChecking: count((row) => row.nextStep === 'keep_checking'),
    // A meeting held is one held, whether or not the row became a lead later
    meetings: count((row) => row.meetingOn !== null),
    converted: count(isConverted),
    contracts: countStaged((row) => row.stage === 'contract'),
    nurturing: countStaged((row) => row.stage === 'nurturing'),
    // As in the spreadsheet: rows whose next step is to pass, whatever their stage
    passed: count((row) => row.nextStep === 'pass'),
  };

  const withStage = countStaged((row) => row.stage !== null);
  let previousReached: number | null = null;
  const stages = PROSPECT_STAGES.map((stage) => {
    const current = countStaged((row) => row.stage === stage);
    if (!isFunnelStage(stage)) {
      return {
        stage,
        current,
        share: ratio(current, withStage),
        reached: null,
        progressRate: null,
      };
    }
    const index = PROSPECT_FUNNEL_STAGES.indexOf(stage);
    const reached = countStaged((row) => funnelIndex(row.stage) >= index);
    const progressRate = previousReached === null ? null : ratio(reached, previousReached);
    previousReached = reached;
    return { stage, current, share: ratio(current, withStage), reached, progressRate };
  });

  const entries = PROSPECT_ENTRIES.map((entry): EntryRow => {
    const own = rows.filter((row) => row.entry === entry);
    const ownStaged = staged.filter((row) => row.entry === entry);
    const byStage = emptyStages();
    for (const row of ownStaged) {
      if (row.stage && row.stage in byStage) byStage[row.stage as ProspectStage] += 1;
    }
    return {
      entry,
      total: own.length,
      hasIssue: own.filter((row) => row.reaction === 'has_issue').length,
      handOver: own.filter((row) => row.nextStep === 'hand_over').length,
      meetings: own.filter((row) => row.meetingOn !== null).length,
      converted: own.filter(isConverted).length,
      contracts: ownStaged.filter((row) => row.stage === 'contract').length,
      byStage,
    };
  });

  // Months from the first record or target to the later of this month and the last target
  const targetByMonth = new Map(targets.map((target) => [target.month, target.meetings]));
  const starts = [...rows.map((row) => monthOf(row.contactedOn)), ...targetByMonth.keys()].sort();
  const ends = [monthOf(today), ...targetByMonth.keys()].sort();
  const months: ProspectSummary['months'] = [];
  const first = starts[0];
  const last = ends[ends.length - 1];
  // Counted once per month first, so the loop over the months does not go over every row again
  const recordedByMonth = new Map<string, number>();
  const meetingsByMonth = new Map<string, number>();
  const add = (map: Map<string, number>, month: string) =>
    map.set(month, (map.get(month) ?? 0) + 1);
  for (const row of rows) {
    add(recordedByMonth, monthOf(row.contactedOn));
    if (row.meetingOn !== null) add(meetingsByMonth, monthOf(row.meetingOn));
  }
  let meetingsToDate = 0;
  if (first && last) {
    // Meetings before the first month still count towards the running total
    for (const [month, meetings] of meetingsByMonth) {
      if (month < first) meetingsToDate += meetings;
    }
    for (let month = first; month <= last; month = nextMonth(month)) {
      const meetings = meetingsByMonth.get(month) ?? 0;
      meetingsToDate += meetings;
      const target = targetByMonth.get(month) ?? null;
      months.push({
        month,
        recorded: recordedByMonth.get(month) ?? 0,
        meetings,
        meetingsToDate,
        target,
        gap: target === null ? null : meetingsToDate - target,
      });
    }
  }

  return {
    overall,
    stages,
    withStage,
    entries,
    months,
    // The rows the list's filters show (api/router.ts), so that the counts match the list
    checks: {
      stageWithoutNextAction: count(
        (row) =>
          isFollowed(row) &&
          row.stage !== null &&
          row.nextActionOn === null &&
          row.nextActionNote === null
      ),
      // As the "overdue" filter: calls turned down are followed in the re-approach list (#161)
      overdue: count(
        (row) => isOpenRow(row) && row.nextActionOn !== null && row.nextActionOn < today
      ),
      // As the "handed over" filter (handed over, not a lead yet), for the rows without a stage
      handOverWithoutStage: count(
        (row) => row.nextStep === 'hand_over' && !isConverted(row) && row.stage === null
      ),
    },
    calls: {
      total: count((row) => row.callResult != null),
      byResult: Object.fromEntries(
        CALL_RESULTS.map((result) => [result, count((row) => row.callResult === result)])
      ) as Record<CallResult, number>,
      refusals: Object.fromEntries(
        REFUSAL_REASONS.map((reason) => [
          reason,
          count((row) => row.callResult === 'refused' && row.refusalReason === reason),
        ])
      ) as Record<RefusalReason, number>,
    },
  };
}
