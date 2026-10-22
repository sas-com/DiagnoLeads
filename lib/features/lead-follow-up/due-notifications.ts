/**
 * Due notices of next actions and takeaways (Refs #85), run once a day by the cron route
 * app/api/cron/notify-due-tasks (08:00 JST):
 * - due_soon: the task is due tomorrow (or today, when it was added after the previous run)
 * - overdue: the due date has passed (up to OVERDUE_NOTICE_LOOKBACK_DAYS days back)
 *
 * Each notice goes out at most once per due date. A run first claims the tasks by setting
 * notified_due_at / notified_overdue_at in one UPDATE that also requires the column to be empty,
 * so a second run (or two runs at once) finds nothing to send. Moving the due date clears both
 * (updateTask, syncHearingNextAction), so the new date gets its own notices.
 *
 * The notice goes to the responsible member (responsibleUserOf in ./due.ts) while they are still
 * a member of the organization. Their setting 次の行動の期限が来たとき (in_app_next_action_due,
 * #164) covers both channels, like the assignment notice of #135: off means no in-app notice and
 * no email. The email (one per member, listing their tasks) is sent only when email is
 * configured, and in test mode only to the allowed domains.
 */
import type { Database } from '@/lib/db/client';
import { leadTasks, leads, notifications, organizationMembers, users } from '@/lib/db/schema';
import { filterAllowedRecipients } from '@/lib/email/allowed-recipients';
import { type EmailLinkItem, renderEmail } from '@/lib/email/templates/render';
import { isEmailConfigured, sendEmail } from '@/lib/features/email';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import {
  getOrCreatePreferences,
  shouldSendInAppNotification,
} from '@/lib/features/notifications/notification-service';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type DueNotice, dueNoticeWindows } from './due';
import { responsibleUserSql } from './service';
import type { TaskKind } from './types/schemas';

/** Tasks claimed per notice and run; the rest wait for the next run */
export const DUE_NOTICE_BATCH = 500;

export interface DueNoticeItem {
  taskId: string;
  organizationId: string;
  leadId: string;
  /** Null for a task from a hearing that kept the default title */
  title: string | null;
  kind: TaskKind;
  dueOn: string;
  checkWith: string | null;
  checkWithUserName: string | null;
  leadName: string | null;
  company: string | null;
  recipientId: string | null;
  notice: DueNotice;
}

export interface DueNoticeDeps {
  sendEmail: (options: {
    to: string[];
    subject: string;
    text: string;
    html: string;
  }) => Promise<unknown>;
  emailEnabled: () => boolean;
  appUrl: string;
}

export interface DueNoticeResult {
  today: string;
  /** Tasks whose notice was claimed by this run */
  claimed: number;
  /** In-app notifications created */
  notified: number;
  /** Emails sent (one per member and organization) */
  emailed: number;
  /** Claimed tasks nobody was told about (no member responsible, or the setting is off) */
  skipped: number;
}

const KIND_LABELS: Record<TaskKind, string> = {
  next_action: '次の行動',
  takeaway: '持ち帰り事項',
};

const HEARING_TASK_TITLE = '次回の打ち合わせ';

function jaDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

function leadLabel(item: Pick<DueNoticeItem, 'company' | 'leadName'>): string {
  const who = [item.company, item.leadName ? `${item.leadName} 様` : null]
    .filter(Boolean)
    .join(' ');
  return who || 'リード';
}

/** Title and body of the in-app notice of one task */
export function buildDueNotice(item: DueNoticeItem, today: string) {
  const kind = KIND_LABELS[item.kind];
  const title = item.title ?? HEARING_TASK_TITLE;
  const lead = leadLabel(item);
  const when =
    item.notice === 'overdue' ? '期限切れ' : item.dueOn === today ? '今日が期限' : '明日が期限';
  const checkWith = item.checkWithUserName ?? item.checkWith;
  const body =
    item.notice === 'overdue'
      ? `${lead} の${kind}「${title}」は期限（${jaDate(item.dueOn)}）を過ぎています。済んでいたら完了にしてください。`
      : `${lead} の${kind}「${title}」は ${jaDate(item.dueOn)} が期限です。`;
  return {
    title: `【${when}・${kind}】${title}（${lead}）`,
    message: checkWith ? `${body}確認先：${checkWith}` : body,
  };
}

/** One email listing a member's tasks of one organization */
export function buildDueNoticeEmail(
  items: DueNoticeItem[],
  today: string,
  appUrl: string
): { subject: string; html: string; text: string } {
  const toLink = (item: DueNoticeItem): EmailLinkItem => ({
    text: buildDueNotice(item, today).title,
    url: `${appUrl}/ja/leads/${item.leadId}`,
  });
  const overdueItems = items.filter((item) => item.notice === 'overdue');
  const dueSoonItems = items.filter((item) => item.notice !== 'overdue');
  const overdue = overdueItems.length;
  const subject =
    overdue > 0
      ? `【期限のお知らせ】期限切れ ${overdue}件を含む ${items.length}件の次の行動・持ち帰り事項`
      : `【期限のお知らせ】期限が近い次の行動・持ち帰り事項 ${items.length}件`;
  const intro = '担当の次の行動・持ち帰り事項の期限が近づいている、または過ぎています。';
  const rendered = renderEmail({
    theme: 'internal',
    preheader: subject.replace(/^【期限のお知らせ】/, ''),
    blocks: [
      {
        type: 'badges',
        items: [
          ...(overdue > 0 ? [{ label: `期限切れ ${overdue}件`, tone: 'danger' as const }] : []),
          ...(dueSoonItems.length > 0
            ? [{ label: `期限が近い ${dueSoonItems.length}件`, tone: 'warning' as const }]
            : []),
        ],
      },
      { type: 'heading', text: '期限のお知らせ' },
      { type: 'paragraph', text: intro },
      { type: 'links', title: '期限切れ', items: overdueItems.map(toLink) },
      { type: 'links', title: '期限が近い', items: dueSoonItems.map(toLink) },
      {
        type: 'paragraph',
        text: '済んでいるものは、リード画面で完了にしてください。',
        muted: true,
      },
    ],
    footer: ['このメールは DiagnoLeads から自動で送信しています。'],
  });
  return { subject, ...rendered };
}

/**
 * Claim the open tasks of one notice in the window: sets its column in the same statement that
 * requires it empty, so only one run gets each task. An overdue claim also fills notified_due_at
 * (no "due soon" after "overdue").
 */
async function claim(
  db: Database,
  notice: DueNotice,
  window: { from: string; to: string },
  now: Date
): Promise<string[]> {
  const column = notice === 'overdue' ? leadTasks.notifiedOverdueAt : leadTasks.notifiedDueAt;
  const open = and(
    isNull(leadTasks.completedAt),
    isNull(column),
    gte(leadTasks.dueOn, window.from),
    lte(leadTasks.dueOn, window.to)
  );
  const batch = db
    .select({ id: leadTasks.id })
    .from(leadTasks)
    .where(open)
    .orderBy(asc(leadTasks.dueOn), asc(leadTasks.id))
    .limit(DUE_NOTICE_BATCH);
  const set =
    notice === 'overdue'
      ? {
          notifiedOverdueAt: now,
          notifiedDueAt: sql`coalesce(${leadTasks.notifiedDueAt}, ${now.toISOString()}::timestamptz)`,
        }
      : { notifiedDueAt: now };
  const rows = await db
    .update(leadTasks)
    .set(set)
    .where(and(open, inArray(leadTasks.id, batch)))
    .returning({ id: leadTasks.id });
  return rows.map((row) => row.id);
}

const checkWithUsers = alias(users, 'check_with_users');

async function loadItems(db: Database, ids: string[], notice: DueNotice): Promise<DueNoticeItem[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      taskId: leadTasks.id,
      organizationId: leadTasks.organizationId,
      leadId: leadTasks.leadId,
      title: leadTasks.title,
      kind: leadTasks.kind,
      dueOn: leadTasks.dueOn,
      checkWith: leadTasks.checkWith,
      checkWithUserName: sql<
        string | null
      >`coalesce(nullif(trim(${checkWithUsers.name}), ''), ${checkWithUsers.email})`,
      leadName: leads.name,
      company: leads.company,
      recipientId: responsibleUserSql,
    })
    .from(leadTasks)
    .innerJoin(leads, eq(leads.id, leadTasks.leadId))
    .leftJoin(checkWithUsers, eq(checkWithUsers.id, leadTasks.checkWithUserId))
    .where(inArray(leadTasks.id, ids));
  return rows.map((row) => ({ ...row, kind: row.kind as TaskKind, notice }));
}

/** Members (with their email) among the recipients, per organization */
async function membersOf(
  db: Database,
  items: DueNoticeItem[]
): Promise<Map<string, { email: string }>> {
  const userIds = [
    ...new Set(items.flatMap((item) => (item.recipientId ? [item.recipientId] : []))),
  ];
  if (userIds.length === 0) return new Map();
  const orgIds = [...new Set(items.map((item) => item.organizationId))];
  const rows = await db
    .select({
      userId: organizationMembers.userId,
      organizationId: organizationMembers.organizationId,
      email: users.email,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        inArray(organizationMembers.userId, userIds),
        inArray(organizationMembers.organizationId, orgIds)
      )
    );
  return new Map(rows.map((row) => [`${row.organizationId}:${row.userId}`, { email: row.email }]));
}

/** The member's own setting for the organization; when it cannot be read the notice goes out */
async function wantsDueNotices(db: Database, userId: string, organizationId: string) {
  try {
    const prefs = await getOrCreatePreferences(userId, organizationId, db);
    return shouldSendInAppNotification('next_action_due', prefs);
  } catch (error) {
    console.error('Due notices: notification preference could not be read:', error);
    return true;
  }
}

/** Send the day's due notices. Safe to run any number of times a day */
export async function runDueTaskNotifications(
  db: Database,
  options: { now?: Date; deps?: Partial<DueNoticeDeps> } = {}
): Promise<DueNoticeResult> {
  const now = options.now ?? new Date();
  const deps: DueNoticeDeps = {
    sendEmail,
    emailEnabled: isEmailConfigured,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? '',
    ...options.deps,
  };
  const today = jstDate(now);
  const windows = dueNoticeWindows(today);

  const overdueIds = await claim(db, 'overdue', windows.overdue, now);
  const dueSoonIds = await claim(db, 'due_soon', windows.due_soon, now);
  const items = [
    ...(await loadItems(db, overdueIds, 'overdue')),
    ...(await loadItems(db, dueSoonIds, 'due_soon')),
  ];
  const result: DueNoticeResult = {
    today,
    claimed: items.length,
    notified: 0,
    emailed: 0,
    skipped: 0,
  };
  if (items.length === 0) return result;

  const members = await membersOf(db, items);
  const byRecipient = new Map<string, { userId: string; email: string; items: DueNoticeItem[] }>();
  for (const item of items) {
    const key = item.recipientId ? `${item.organizationId}:${item.recipientId}` : null;
    const member = key ? members.get(key) : undefined;
    if (!key || !member || !item.recipientId) {
      result.skipped += 1;
      continue;
    }
    const entry = byRecipient.get(key) ?? {
      userId: item.recipientId,
      email: member.email,
      items: [],
    };
    entry.items.push(item);
    byRecipient.set(key, entry);
  }

  for (const entry of byRecipient.values()) {
    const organizationId = entry.items[0].organizationId;
    if (!(await wantsDueNotices(db, entry.userId, organizationId))) {
      result.skipped += entry.items.length;
      continue;
    }
    await db.insert(notifications).values(
      entry.items.map((item) => ({
        userId: entry.userId,
        organizationId,
        type: 'next_action_due' as const,
        ...buildDueNotice(item, today),
        data: {
          leadId: item.leadId,
          taskId: item.taskId,
          kind: item.kind,
          notice: item.notice,
          dueOn: item.dueOn,
        },
      }))
    );
    result.notified += entry.items.length;

    if (!deps.emailEnabled()) continue;
    // In test mode only the allowed domains are mailed
    const to = filterAllowedRecipients([entry.email]);
    if (to.length === 0) continue;
    try {
      await deps.sendEmail({ to, ...buildDueNoticeEmail(entry.items, today, deps.appUrl) });
      result.emailed += 1;
    } catch (error) {
      // The in-app notices are kept; the email is not retried (each notice goes out once)
      console.error('Due notices: email failed:', error);
    }
  }
  return result;
}
