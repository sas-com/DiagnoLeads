/**
 * Takeaways and due notices of the follow-up (#85): the kind and whom to check with in the input
 * schemas, the Japan-day windows of the notices, who gets them and their wording. The claiming,
 * the settings and the recipients on a real database are covered by
 * test/unit/integration/lead-follow-up-takeaways.db.test.ts.
 */
import {
  addDays,
  dueNoticeWindows,
  OVERDUE_NOTICE_LOOKBACK_DAYS,
  responsibleUserOf,
} from '@/lib/features/lead-follow-up/due';
import {
  buildDueNotice,
  buildDueNoticeEmail,
  type DueNoticeItem,
} from '@/lib/features/lead-follow-up/due-notifications';
import {
  DUE_TASKS_MAX,
  createTaskSchema,
  dueTasksSchema,
  updateTaskSchema,
} from '@/lib/features/lead-follow-up/types/schemas';
import { shouldSendInAppNotification } from '@/lib/features/notifications/notification-service';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { describe, expect, it } from 'vitest';

const ORG = '660e8400-e29b-41d4-a716-446655440000';
const LEAD = '770e8400-e29b-41d4-a716-446655440001';
const MEMBER = '880e8400-e29b-41d4-a716-446655440002';
const TASK = '990e8400-e29b-41d4-a716-446655440003';

const base = { organizationId: ORG, leadId: LEAD, title: '保守費用を回答する', dueOn: '2026-10-20' };

describe('task kind and whom to check with', () => {
  it('is a next action unless told otherwise', () => {
    expect(createTaskSchema.parse(base).kind).toBe('next_action');
  });

  it('takes whom to check with on a takeaway, as text or as a member', () => {
    expect(
      createTaskSchema.parse({ ...base, kind: 'takeaway', checkWith: '  広報部 ' })
    ).toMatchObject({ kind: 'takeaway', checkWith: '広報部' });
    expect(
      createTaskSchema.parse({ ...base, kind: 'takeaway', checkWithUserId: MEMBER })
    ).toMatchObject({ kind: 'takeaway', checkWithUserId: MEMBER });
    // An empty text means nobody
    expect(createTaskSchema.parse({ ...base, kind: 'takeaway', checkWith: '' }).checkWith).toBe(
      null
    );
  });

  it('refuses whom to check with on a next action, both at once, or an unknown kind', () => {
    expect(createTaskSchema.safeParse({ ...base, checkWith: '広報部' }).success).toBe(false);
    expect(
      createTaskSchema.safeParse({
        ...base,
        kind: 'takeaway',
        checkWith: '広報部',
        checkWithUserId: MEMBER,
      }).success
    ).toBe(false);
    expect(createTaskSchema.safeParse({ ...base, kind: 'memo' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...base, checkWith: 'x'.repeat(201) }).success).toBe(false);
  });

  it('changes the kind or whom to check with on update', () => {
    expect(
      updateTaskSchema.parse({ organizationId: ORG, id: TASK, kind: 'takeaway', checkWith: '法務' })
    ).toMatchObject({ kind: 'takeaway', checkWith: '法務' });
    expect(
      updateTaskSchema.safeParse({ organizationId: ORG, id: TASK, kind: 'next_action', checkWith: '法務' })
        .success
    ).toBe(false);
  });

  it('lists the dashboard for the user by default', () => {
    expect(dueTasksSchema.parse({ organizationId: ORG }).scope).toBe('mine');
    expect(dueTasksSchema.parse({ organizationId: ORG, scope: 'all' }).scope).toBe('all');
    expect(dueTasksSchema.safeParse({ organizationId: ORG, scope: 'team' }).success).toBe(false);
  });

  it('lists more when the dashboard card is opened, up to DUE_TASKS_MAX (#431)', () => {
    expect(dueTasksSchema.parse({ organizationId: ORG }).limit).toBeUndefined();
    expect(dueTasksSchema.parse({ organizationId: ORG, limit: DUE_TASKS_MAX }).limit).toBe(200);
    for (const limit of [0, DUE_TASKS_MAX + 1, 1.5]) {
      expect(dueTasksSchema.safeParse({ organizationId: ORG, limit }).success).toBe(false);
    }
  });
});

describe('due notice windows (Japan calendar day)', () => {
  it('moves days across months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('covers today and tomorrow for "due soon" and the last days for "overdue"', () => {
    expect(dueNoticeWindows('2026-10-16')).toEqual({
      due_soon: { from: '2026-10-16', to: '2026-10-17' },
      overdue: { from: addDays('2026-10-16', -OVERDUE_NOTICE_LOOKBACK_DAYS), to: '2026-10-15' },
    });
  });

  it('uses the Japan day of the run, not the UTC day', () => {
    // 23:00 UTC on 10-15 is 08:00 JST on 10-16, when the cron runs
    const today = jstDate(new Date('2026-10-15T23:00:00Z'));
    expect(today).toBe('2026-10-16');
    expect(dueNoticeWindows(today).due_soon.to).toBe('2026-10-17');
    // 14:59 UTC is still the same Japan day, 15:00 UTC is the next one
    expect(jstDate(new Date('2026-10-16T14:59:59Z'))).toBe('2026-10-16');
    expect(jstDate(new Date('2026-10-16T15:00:00Z'))).toBe('2026-10-17');
  });
});

describe('who gets the notices', () => {
  it("is the task's assignee, else the lead's assignee, else whoever created it", () => {
    expect(responsibleUserOf({ assigneeId: 'a', leadAssigneeId: 'l', createdBy: 'c' })).toBe('a');
    expect(responsibleUserOf({ assigneeId: null, leadAssigneeId: 'l', createdBy: 'c' })).toBe('l');
    expect(responsibleUserOf({ assigneeId: null, leadAssigneeId: null, createdBy: 'c' })).toBe('c');
    expect(responsibleUserOf({ assigneeId: null, leadAssigneeId: null, createdBy: null })).toBe(
      null
    );
  });

  it('follows the setting 次の行動の期限が来たとき', () => {
    const prefs = { inAppNextActionDue: false } as Parameters<
      typeof shouldSendInAppNotification
    >[1];
    expect(shouldSendInAppNotification('next_action_due', prefs)).toBe(false);
    expect(
      shouldSendInAppNotification('next_action_due', { ...prefs, inAppNextActionDue: true })
    ).toBe(true);
  });
});

describe('due notice wording', () => {
  const item = (overrides: Partial<DueNoticeItem> = {}): DueNoticeItem => ({
    taskId: TASK,
    organizationId: ORG,
    leadId: LEAD,
    title: '見積もりを送る',
    kind: 'next_action',
    dueOn: '2026-10-17',
    checkWith: null,
    checkWithUserName: null,
    leadName: '山田 花子',
    company: '架空商事',
    recipientId: MEMBER,
    notice: 'due_soon',
    ...overrides,
  });

  it('says tomorrow, today or overdue, and which kind', () => {
    expect(buildDueNotice(item(), '2026-10-16')).toEqual({
      title: '【明日が期限・次の行動】見積もりを送る（架空商事 山田 花子 様）',
      message: '架空商事 山田 花子 様 の次の行動「見積もりを送る」は 10月17日 が期限です。',
    });
    expect(buildDueNotice(item({ dueOn: '2026-10-16' }), '2026-10-16').title).toBe(
      '【今日が期限・次の行動】見積もりを送る（架空商事 山田 花子 様）'
    );
    const overdue = buildDueNotice(
      item({ notice: 'overdue', dueOn: '2026-10-14', kind: 'takeaway', checkWith: '広報部' }),
      '2026-10-16'
    );
    expect(overdue.title).toBe('【期限切れ・持ち帰り事項】見積もりを送る（架空商事 山田 花子 様）');
    expect(overdue.message).toBe(
      '架空商事 山田 花子 様 の持ち帰り事項「見積もりを送る」は期限（10月14日）を過ぎています。済んでいたら完了にしてください。確認先：広報部'
    );
  });

  it('names a hearing task and a lead without a name', () => {
    const notice = buildDueNotice(
      item({ title: null, leadName: null, company: null }),
      '2026-10-16'
    );
    expect(notice.title).toBe('【明日が期限・次の行動】次回の打ち合わせ（リード）');
  });

  it('lists the tasks of one member in one email, escaped in the HTML', () => {
    const email = buildDueNoticeEmail(
      [item({ title: '<b>見積もり</b>' }), item({ notice: 'overdue', dueOn: '2026-10-15' })],
      '2026-10-16',
      'https://app.example.com'
    );
    expect(email.subject).toBe('【期限のお知らせ】期限切れ 1件を含む 2件の次の行動・持ち帰り事項');
    expect(email.text).toContain(`https://app.example.com/ja/leads/${LEAD}`);
    expect(email.html).toContain('&lt;b&gt;見積もり&lt;/b&gt;');
    expect(email.html).not.toContain('<b>');
    // Overdue tasks are listed first, under their own heading
    expect(email.text.indexOf('【期限切れ】')).toBeLessThan(email.text.indexOf('【期限が近い】'));
  });
});
