/**
 * Lead follow-up (#136, #85): due status, order of next actions, the next meeting date of a
 * hearing and the input schemas. The DB behaviour is covered by
 * test/unit/integration/lead-follow-up.db.test.ts.
 */
import { nextMeetingDateOf, sortTasks, taskDue } from '@/lib/features/lead-follow-up/due';
import {
  createTaskSchema,
  recordContactSchema,
  updateTaskSchema,
} from '@/lib/features/lead-follow-up/types/schemas';
import { describe, expect, it } from 'vitest';

const ORG = '660e8400-e29b-41d4-a716-446655440000';
const LEAD = '770e8400-e29b-41d4-a716-446655440001';

describe('taskDue', () => {
  it.each([
    [{ dueOn: '2026-10-15', done: false }, 'overdue'],
    [{ dueOn: '2026-10-16', done: false }, 'today'],
    [{ dueOn: '2026-10-17', done: false }, 'upcoming'],
    [{ dueOn: '2026-10-01', done: true }, 'done'],
  ] as const)('%o on 2026-10-16 is %s', (task, expected) => {
    expect(taskDue(task, '2026-10-16')).toBe(expected);
  });

  it('compares calendar days across months and years', () => {
    expect(taskDue({ dueOn: '2026-12-31', done: false }, '2027-01-01')).toBe('overdue');
  });
});

describe('sortTasks', () => {
  it('puts open ones by due date first, then done ones latest first', () => {
    const task = (id: string, dueOn: string, completedAt: string | null) => ({
      id,
      dueOn,
      done: completedAt !== null,
      completedAt: completedAt ? new Date(completedAt) : null,
    });
    const sorted = sortTasks([
      task('done-old', '2026-10-01', '2026-10-02T00:00:00Z'),
      task('later', '2026-11-01', null),
      task('done-new', '2026-10-05', '2026-10-10T00:00:00Z'),
      task('sooner', '2026-10-20', null),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['sooner', 'later', 'done-new', 'done-old']);
  });
});

describe('nextMeetingDateOf', () => {
  it('reads the date of the next meeting field', () => {
    expect(
      nextMeetingDateOf({ nextMeetingDate: { value: '2026-11-05', status: 'done', source: null } })
    ).toBe('2026-11-05');
  });

  it.each([
    ['no fields', null],
    ['no date yet', { nextMeetingDate: { status: 'next', source: null } }],
    ['another field', { dealRating: { value: 'a', status: 'done', source: null } }],
    ['not a date', { nextMeetingDate: { value: ['2026-11-05'], status: 'done', source: null } }],
  ])('is null for %s', (_, fields) => {
    expect(nextMeetingDateOf(fields)).toBeNull();
  });
});

describe('input schemas', () => {
  it('takes a contact without a note, and a blank note as none', () => {
    expect(recordContactSchema.parse({ organizationId: ORG, leadId: LEAD, kind: 'call' }).note).toBe(
      undefined
    );
    expect(
      recordContactSchema.parse({ organizationId: ORG, leadId: LEAD, kind: 'email', note: '   ' }).note
    ).toBeNull();
    expect(
      recordContactSchema.safeParse({ organizationId: ORG, leadId: LEAD, kind: 'visit' }).success
    ).toBe(false);
  });

  it('needs a title and a real due date for a next action', () => {
    const base = { organizationId: ORG, leadId: LEAD, title: '資料を送る', dueOn: '2026-11-02' };
    expect(createTaskSchema.parse({ ...base, title: '  資料を送る ' }).title).toBe('資料を送る');
    expect(createTaskSchema.safeParse({ ...base, title: '   ' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...base, dueOn: '2026-02-30' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...base, assigneeId: LEAD }).success).toBe(false);
  });

  it('changes only the given fields of a next action', () => {
    expect(updateTaskSchema.parse({ organizationId: ORG, id: LEAD, done: true })).toEqual({
      organizationId: ORG,
      id: LEAD,
      done: true,
    });
  });
});
