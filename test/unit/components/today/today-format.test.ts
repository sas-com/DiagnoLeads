/**
 * What the 今日 screen (#556) makes of its data: the week's meetings split into today and the rest
 * of the week, the counts of the day's contacts by kind, and the deals that need attention
 * (passed close dates first). Days are Japan calendar days.
 */
import {
  contactCounts,
  dealsNeedingAttention,
  splitMeetings,
} from '@/components/features/today/today-format';
import { describe, expect, it } from 'vitest';

const TODAY = '2026-10-29';

describe('splitMeetings', () => {
  it('puts today’s meetings first and the rest of the week after, in the order given', () => {
    const meetings = [
      { id: 'a', nextMeetingDate: '2026-10-29' },
      { id: 'b', nextMeetingDate: '2026-10-30' },
      { id: 'c', nextMeetingDate: '2026-10-29' },
      { id: 'd', nextMeetingDate: '2026-11-01' },
    ];

    const { today, later } = splitMeetings(meetings, TODAY);

    expect(today.map((m) => m.id)).toEqual(['a', 'c']);
    expect(later.map((m) => m.id)).toEqual(['b', 'd']);
  });

  it('leaves out a day that has passed', () => {
    const { today, later } = splitMeetings([{ nextMeetingDate: '2026-10-28' }], TODAY);

    expect([...today, ...later]).toEqual([]);
  });
});

describe('contactCounts', () => {
  it('lists every kind in the order of the screens, no answers last, with 0 for those without', () => {
    expect(contactCounts({ call: 2, no_answer: 1 })).toEqual([
      { kind: 'call', count: 2 },
      { kind: 'email', count: 0 },
      { kind: 'visit', count: 0 },
      { kind: 'online_meeting', count: 0 },
      { kind: 'no_answer', count: 1 },
    ]);
  });
});

describe('dealsNeedingAttention', () => {
  const deal = (
    id: string,
    values: { stage?: string; expectedCloseOn?: string | null; hasOpenTask?: boolean } = {}
  ) => ({ id, stage: 'proposal', expectedCloseOn: null, hasOpenTask: true, ...values });

  it('puts the deals past their close date first, the earliest first, then those without a next action', () => {
    const marked = dealsNeedingAttention(
      [
        deal('no-task-late', { expectedCloseOn: '2026-12-01', hasOpenTask: false }),
        deal('no-task-undated', { hasOpenTask: false }),
        deal('overdue-recent', { expectedCloseOn: '2026-10-28' }),
        deal('no-task-soon', { expectedCloseOn: '2026-11-05', hasOpenTask: false }),
        deal('overdue-old', { expectedCloseOn: '2026-09-30', hasOpenTask: false }),
      ],
      TODAY
    );

    expect(marked.map(({ deal: d }) => d.id)).toEqual([
      'overdue-old',
      'overdue-recent',
      'no-task-soon',
      'no-task-late',
      'no-task-undated',
    ]);
    expect(marked[0].flags).toEqual({ overdue: true, noNextAction: true });
    expect(marked[2].flags).toEqual({ overdue: false, noNextAction: true });
  });

  it('leaves out deals without a mark: on track, due today, or closed', () => {
    const marked = dealsNeedingAttention(
      [
        deal('on-track', { expectedCloseOn: '2026-11-30' }),
        deal('due-today', { expectedCloseOn: TODAY }),
        deal('won', { stage: 'won', expectedCloseOn: '2026-10-01', hasOpenTask: false }),
        deal('lost', { stage: 'lost', hasOpenTask: false }),
      ],
      TODAY
    );

    expect(marked).toEqual([]);
  });
});
