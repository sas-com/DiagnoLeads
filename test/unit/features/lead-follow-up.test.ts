/**
 * Lead follow-up (#136, #85, #554): due status, order of next actions, the next meeting date of
 * a hearing and the input schemas. The DB behaviour is covered by
 * test/unit/integration/lead-follow-up.db.test.ts and lead-contact-activities.db.test.ts.
 */
import { updateDealSchema } from '@/lib/features/deals/types/schemas';
import { nextMeetingDateOf, sortTasks, taskDue } from '@/lib/features/lead-follow-up/due';
import {
  CONTACT_KINDS,
  QUICK_CONTACT_KINDS,
  REACHED_CONTACT_KINDS,
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
      recordContactSchema.safeParse({ organizationId: ORG, leadId: LEAD, kind: 'meeting' }).success
    ).toBe(false);
  });

  it('takes a visit or an online meeting with its time, duration, outcome and deal (#554)', () => {
    const base = { organizationId: ORG, leadId: LEAD, kind: 'visit' as const };
    const at = new Date('2026-10-20T14:00:00+09:00');
    expect(
      recordContactSchema.parse({
        ...base,
        contactedAt: at,
        durationMinutes: 90,
        outcome: 'advanced',
        dealId: LEAD,
      })
    ).toMatchObject({ contactedAt: at, durationMinutes: 90, outcome: 'advanced', dealId: LEAD });
    expect(recordContactSchema.parse({ ...base, kind: 'online_meeting' }).kind).toBe('online_meeting');

    const refused = (values: Record<string, unknown>) =>
      recordContactSchema.safeParse({ ...base, ...values }).success === false;
    expect(refused({ contactedAt: new Date('1999-12-31T23:59:00+09:00') })).toBe(true);
    expect(refused({ contactedAt: '2026-10-20T14:00:00+09:00' })).toBe(true);
    expect(refused({ durationMinutes: 0 })).toBe(true);
    expect(refused({ durationMinutes: 24 * 60 + 1 })).toBe(true);
    expect(refused({ durationMinutes: 1.5 })).toBe(true);
    expect(refused({ outcome: 'lost' })).toBe(true);
    expect(refused({ dealId: 'deal-1' })).toBe(true);
    expect(refused({ durationMinutes: 24 * 60, outcome: 'setback' })).toBe(false);
  });

  it('takes no duration or outcome for a "no answer"', () => {
    const base = { organizationId: ORG, leadId: LEAD, kind: 'no_answer' as const };
    expect(recordContactSchema.safeParse(base).success).toBe(true);
    expect(recordContactSchema.safeParse({ ...base, durationMinutes: null, outcome: null }).success).toBe(
      true
    );
    expect(recordContactSchema.safeParse({ ...base, durationMinutes: 3 }).success).toBe(false);
    expect(recordContactSchema.safeParse({ ...base, outcome: 'no_change' }).success).toBe(false);
  });

  it("relies on a deal never moving to another lead (a record's deal is one of its lead's)", () => {
    // Moving a deal to another lead would leave its records on the old lead (decision
    // 2026-10-25-contact-visits-and-meetings): decide what happens to them first
    expect(updateDealSchema.shape).not.toHaveProperty('leadId');
  });

  it('keeps the one-tap kinds and the kinds that end the wait for the first contact apart', () => {
    expect(QUICK_CONTACT_KINDS).toEqual(['call', 'email', 'no_answer']);
    expect(CONTACT_KINDS).toEqual(expect.arrayContaining([...QUICK_CONTACT_KINDS, ...REACHED_CONTACT_KINDS]));
    // "No answer" never ends the wait (#136); a visit or an online meeting does (#554)
    expect(REACHED_CONTACT_KINDS).toEqual(['call', 'email', 'visit', 'online_meeting']);
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
