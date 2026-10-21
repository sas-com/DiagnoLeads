import {
  PROSPECT_ENTRIES,
  PROSPECT_FUNNEL_STAGES,
  PROSPECT_STAGES,
  type ProspectEntry,
  type ProspectFunnelStage,
  type ProspectStage,
} from './types/schemas';

/**
 * The summary of the prospect list (#265), with the same definitions as the spreadsheet's
 * "summary for management" sheet so the numbers do not change when the list moves here.
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
    contracts: number;
    nurturing: number;
    passed: number;
  };
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
  checks: {
    stageWithoutNextAction: number;
    overdue: number;
    handOverWithoutStage: number;
  };
}

const isFunnelStage = (stage: string | null): stage is ProspectFunnelStage =>
  (PROSPECT_FUNNEL_STAGES as readonly string[]).includes(stage ?? '');

const funnelIndex = (stage: string | null) =>
  isFunnelStage(stage) ? PROSPECT_FUNNEL_STAGES.indexOf(stage) : -1;

const ratio = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);

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

  const overall = {
    total: rows.length,
    hasIssue: count((row) => row.reaction === 'has_issue'),
    handOver: count((row) => row.nextStep === 'hand_over'),
    keepChecking: count((row) => row.nextStep === 'keep_checking'),
    meetings: count((row) => row.meetingOn !== null),
    contracts: count((row) => row.stage === 'contract'),
    nurturing: count((row) => row.stage === 'nurturing'),
    // As in the spreadsheet: rows whose next step is to pass, whatever their stage
    passed: count((row) => row.nextStep === 'pass'),
  };

  const withStage = count((row) => row.stage !== null);
  let previousReached: number | null = null;
  const stages = PROSPECT_STAGES.map((stage) => {
    const current = count((row) => row.stage === stage);
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
    const reached = count((row) => funnelIndex(row.stage) >= index);
    const progressRate = previousReached === null ? null : ratio(reached, previousReached);
    previousReached = reached;
    return { stage, current, share: ratio(current, withStage), reached, progressRate };
  });

  const entries = PROSPECT_ENTRIES.map((entry): EntryRow => {
    const own = rows.filter((row) => row.entry === entry);
    const byStage = emptyStages();
    for (const row of own) {
      if (row.stage && row.stage in byStage) byStage[row.stage as ProspectStage] += 1;
    }
    return {
      entry,
      total: own.length,
      hasIssue: own.filter((row) => row.reaction === 'has_issue').length,
      handOver: own.filter((row) => row.nextStep === 'hand_over').length,
      meetings: own.filter((row) => row.meetingOn !== null).length,
      contracts: own.filter((row) => row.stage === 'contract').length,
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
    checks: {
      stageWithoutNextAction: count(
        (row) => row.stage !== null && row.nextActionOn === null && row.nextActionNote === null
      ),
      overdue: count((row) => row.nextActionOn !== null && row.nextActionOn < today),
      handOverWithoutStage: count((row) => row.nextStep === 'hand_over' && row.stage === null),
    },
  };
}
