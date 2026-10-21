import { type SummaryProspect, summarizeProspects } from '@/lib/features/prospects/summary';
import { describe, expect, it } from 'vitest';

const row = (values: Partial<SummaryProspect>): SummaryProspect => ({
  contactedOn: '2026-10-14',
  entry: 'member_network',
  reaction: null,
  nextStep: null,
  nextActionOn: null,
  nextActionNote: null,
  stage: null,
  meetingOn: null,
  ...values,
});

describe('summarizeProspects', () => {
  it('counts as the spreadsheet does: passed is the next step, not the stage', () => {
    const summary = summarizeProspects(
      [
        row({ reaction: 'has_issue', nextStep: 'hand_over', stage: 'interest' }),
        row({ nextStep: 'keep_checking', stage: 'interest' }),
        row({ nextStep: 'pass', stage: 'dropped' }),
        row({ nextStep: 'pass' }),
        row({ stage: 'contract', meetingOn: '2026-11-05' }),
        row({ stage: 'nurturing' }),
      ],
      [],
      '2026-10-21'
    );
    expect(summary.overall).toEqual({
      total: 6,
      hasIssue: 1,
      handOver: 1,
      keepChecking: 1,
      meetings: 1,
      contracts: 1,
      nurturing: 1,
      passed: 2,
    });
  });

  it('gives the share, the cumulative reach and the progress from the previous stage', () => {
    const summary = summarizeProspects(
      [
        row({ stage: 'interest' }),
        row({ stage: 'interest' }),
        row({ stage: 'quick_diagnosis' }),
        row({ stage: 'spec_survey' }),
        row({ stage: 'dropped' }),
        row({}),
      ],
      [],
      '2026-10-21'
    );
    const byStage = Object.fromEntries(summary.stages.map((s) => [s.stage, s]));
    expect(summary.withStage).toBe(5);
    expect(byStage.interest).toMatchObject({ current: 2, share: 0.4, reached: 4, progressRate: null });
    expect(byStage.quick_diagnosis).toMatchObject({ current: 1, reached: 2, progressRate: 0.5 });
    expect(byStage.spec_survey).toMatchObject({ reached: 1, progressRate: 0.5 });
    expect(byStage.proposal).toMatchObject({ reached: 0, progressRate: 0 });
    expect(byStage.contract).toMatchObject({ reached: 0, progressRate: 0 });
    expect(byStage.dropped).toMatchObject({ current: 1, share: 0.2, reached: null });
  });

  it('breaks the rows down by entry and by entry and stage', () => {
    const summary = summarizeProspects(
      [
        row({ entry: 'bp_company', stage: 'interest', reaction: 'has_issue' }),
        row({ entry: 'bp_company', stage: 'interest', nextStep: 'hand_over' }),
        row({ entry: 'other', meetingOn: '2026-10-20' }),
      ],
      [],
      '2026-10-21'
    );
    const bp = summary.entries.find((e) => e.entry === 'bp_company');
    expect(bp).toMatchObject({ total: 2, hasIssue: 1, handOver: 1, meetings: 0 });
    expect(bp?.byStage.interest).toBe(2);
    expect(summary.entries.find((e) => e.entry === 'other')?.meetings).toBe(1);
    expect(summary.entries.map((e) => e.entry)).toHaveLength(5);
  });

  it('lists the months from the first record to the last target, with the running totals', () => {
    const summary = summarizeProspects(
      [
        row({ contactedOn: '2026-10-14', meetingOn: '2026-10-30' }),
        row({ contactedOn: '2026-10-20', meetingOn: '2026-12-02' }),
      ],
      [
        { month: '2026-11-01', meetings: 8 },
        { month: '2027-01-01', meetings: 15 },
      ],
      '2026-10-21'
    );
    expect(summary.months).toEqual([
      { month: '2026-10-01', recorded: 2, meetings: 1, meetingsToDate: 1, target: null, gap: null },
      { month: '2026-11-01', recorded: 0, meetings: 0, meetingsToDate: 1, target: 8, gap: -7 },
      { month: '2026-12-01', recorded: 0, meetings: 1, meetingsToDate: 2, target: null, gap: null },
      { month: '2027-01-01', recorded: 0, meetings: 0, meetingsToDate: 2, target: 15, gap: -13 },
    ]);
  });

  it('counts what sales should check; a next action today is not overdue', () => {
    const summary = summarizeProspects(
      [
        row({ stage: 'interest' }),
        row({ stage: 'interest', nextActionNote: '11月中旬' }),
        row({ stage: 'interest', nextActionOn: '2026-10-20' }),
        row({ nextActionOn: '2026-10-21' }),
        row({ nextStep: 'hand_over' }),
      ],
      [],
      '2026-10-21'
    );
    expect(summary.checks).toEqual({ stageWithoutNextAction: 1, overdue: 1, handOverWithoutStage: 1 });
  });

  it('has no months without rows or targets', () => {
    expect(summarizeProspects([], [], '2026-10-21').months).toEqual([]);
  });
});
